"""Posta kaynakları.

`MailSource` arayüzü senkron motorunun ihtiyaç duyduğu *yalnızca okuma* işlemlerini
tanımlar. IMAP tarafında:
- klasörler daima `EXAMINE` (select_folder(readonly=True)) ile açılır,
- içerik daima `BODY.PEEK[...]` ile çekilir (\\Seen bayrağı değişmez),
- sunucuda değişiklik yapan komutlar (STORE, COPY, MOVE, EXPUNGE, APPEND, CREATE,
  DELETE, RENAME, SUBSCRIBE...) `ReadOnlyIMAP` sarmalayıcısı tarafından engellenir.
Böylece Outlook/IceWarp kurallarıyla oluşan klasör yapısına dokunulmaz.
"""

from __future__ import annotations

import logging
import mailbox
import os
import ssl
import zlib
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import date
from email.utils import collapse_rfc2231_value, decode_rfc2231
from pathlib import Path
from typing import Protocol
from urllib.parse import unquote

from .parse import (
    ParsedAttachment,
    ParsedMessage,
    _decode_header_value,
    decode_bytes,
    decode_transfer,
    extract_section,
    parse_partial,
    parse_rfc822,
)

log = logging.getLogger(__name__)


class SourceError(Exception):
    """Geçici olabilecek kaynak hatası (bağlantı kopması vb.)."""


class SourceAuthError(SourceError):
    """Kimlik doğrulama hatası — yeniden deneme anlamsız."""


@dataclass
class FolderInfo:
    name: str
    delimiter: str | None
    flags: list[str]
    selectable: bool = True

    @property
    def role(self) -> str | None:
        f = {x.lower() for x in self.flags}
        for flag, role in (("\\sent", "sent"), ("\\drafts", "drafts"), ("\\trash", "trash"),
                           ("\\junk", "junk"), ("\\archive", "archive"), ("\\all", "all")):
            if flag in f:
                return role
        n = self.name.lower().split(self.delimiter or "/")[-1] if self.delimiter else self.name.lower()
        if self.name.upper() == "INBOX":
            return "inbox"
        names = {
            "sent": "sent", "sent items": "sent", "sent messages": "sent", "gönderilmiş öğeler": "sent",
            "gönderilenler": "sent", "gönderilen": "sent",
            "drafts": "drafts", "taslaklar": "drafts",
            "trash": "trash", "deleted messages": "trash", "deleted items": "trash", "silinmiş öğeler": "trash",
            "spam": "junk", "junk": "junk", "junk e-mail": "junk", "gereksiz e-posta": "junk", "karantina": "junk",
            "archive": "archive", "arşiv": "archive",
        }
        return names.get(n)


@dataclass
class FolderStatus:
    uidvalidity: int
    exists: int
    uidnext: int | None = None


@dataclass
class FetchedMessage:
    uid: int
    flags: list[str]
    parsed: ParsedMessage | None
    error: str | None = None


@dataclass
class SourceInfo:
    kind: str
    host: str | None = None
    capabilities: list[str] = field(default_factory=list)


class MailSource(Protocol):
    info: SourceInfo

    def list_folders(self) -> list[FolderInfo]: ...
    def open_folder(self, name: str) -> FolderStatus: ...
    def search_uids(self, since: date | None) -> list[int]: ...
    def fetch(self, uids: list[int]) -> Iterator[FetchedMessage]: ...
    def fetch_flags(self, uids: list[int]) -> dict[int, list[str]]: ...
    def fetch_section(self, folder: str, uidvalidity: int, uid: int, section: str) -> tuple[bytes, str]: ...
    def close(self) -> None: ...


# =================================================================== IMAP


FORBIDDEN_IMAP_METHODS = frozenset({
    "add_flags", "remove_flags", "set_flags", "add_gmail_labels", "remove_gmail_labels", "set_gmail_labels",
    "copy", "move", "expunge", "uid_expunge", "append", "multiappend", "create_folder", "delete_folder",
    "rename_folder", "subscribe_folder", "unsubscribe_folder", "delete_messages", "undelete_messages",
    "select_folder", "_raw_command", "_command_and_check", "xlist_folders", "set_quota", "setacl",
})
_ALLOWED_IMAP_METHODS = frozenset({
    "login", "logout", "capabilities", "has_capability", "list_folders", "folder_status", "search",
    "fetch", "id_", "noop", "starttls", "namespace", "shutdown",
})


class ReadOnlyIMAP:
    """IMAPClient sarmalayıcısı: yalnızca izinli okuma metodlarına erişim verir."""

    def __init__(self, client):
        object.__setattr__(self, "_c", client)

    def examine(self, name: str) -> dict:
        # select_folder(readonly=True) IMAP EXAMINE komutunu gönderir.
        return self._c.select_folder(name, readonly=True)

    def __getattr__(self, item):
        if item in FORBIDDEN_IMAP_METHODS or item not in _ALLOWED_IMAP_METHODS:
            raise PermissionError(f"Salt okunur IMAP: '{item}' kullanılamaz")
        return getattr(self._c, item)

    def __setattr__(self, key, value):
        raise PermissionError("Salt okunur IMAP")


def _b(v) -> str:
    if v is None:
        return ""
    if isinstance(v, bytes):
        return v.decode("utf-8", "replace")
    return str(v)


def _params(raw) -> dict[str, str]:
    out: dict[str, str] = {}
    if not raw or not isinstance(raw, (tuple, list)):
        return out
    items = list(raw)
    for i in range(0, len(items) - 1, 2):
        out[_b(items[i]).lower()] = _b(items[i + 1])
    return out


def _param_filename(params: dict[str, str], *keys: str) -> str:
    for key in keys:
        if key in params:
            return _decode_header_value(params[key])
        star = key + "*"
        if star in params:  # RFC 2231: utf-8''%C3%BC.pdf
            v = params[star]
            if "''" in v:
                cs, _, enc = v.partition("''")
                return unquote(enc, encoding=cs or "utf-8", errors="replace")
            return unquote(v)
        conts = sorted(k for k in params if k.startswith(key + "*") and k != star)
        if conts:
            raw = "".join(params[k] for k in conts)
            try:
                return collapse_rfc2231_value(decode_rfc2231(raw))
            except Exception:
                return unquote(raw.split("''", 1)[-1])
    return ""


def walk_bodystructure(bs, prefix: str = "") -> Iterator[dict]:
    """IMAP BODYSTRUCTURE ağacını düz parça listesine çevirir."""
    if bs.is_multipart:
        for i, part in enumerate(bs[0], 1):
            sec = f"{prefix}.{i}" if prefix else str(i)
            yield from walk_bodystructure(part, sec)
        return
    mtype, subtype = _b(bs[0]).lower(), _b(bs[1]).lower()
    ctype = f"{mtype}/{subtype}"
    params = _params(bs[2])
    content_id = _b(bs[3]) or None
    encoding = _b(bs[5]).lower()
    size = int(bs[6]) if len(bs) > 6 and isinstance(bs[6], int) else None
    if mtype == "text":
        disp_idx = 9
    elif ctype == "message/rfc822":
        disp_idx = 11
    else:
        disp_idx = 8
    disposition, dparams = "", {}
    if len(bs) > disp_idx and isinstance(bs[disp_idx], tuple) and bs[disp_idx]:
        disposition = _b(bs[disp_idx][0]).lower()
        dparams = _params(bs[disp_idx][1]) if len(bs[disp_idx]) > 1 else {}
    filename = _param_filename(dparams, "filename") or _param_filename(params, "name")
    yield {
        "section": prefix or "1",
        "ctype": ctype,
        "charset": params.get("charset"),
        "encoding": encoding,
        "size": size,
        "disposition": disposition,
        "filename": filename,
        "content_id": content_id.strip("<>") if content_id else None,
    }


def _is_att_part(p: dict) -> bool:
    if p["disposition"] == "attachment" or p["filename"]:
        return True
    return not p["ctype"].startswith("text/")


class ImapSource:
    def __init__(self, *, host: str, port: int, security: str, username: str, password: str,
                 timeout: int = 60, full_fetch_max_bytes: int = 2 * 1024 * 1024,
                 body_max_chars: int = 200_000, keep_payload_max: int = 0,
                 _ssl_context: ssl.SSLContext | None = None):
        if not host or not username or not password:
            raise SourceAuthError("IMAP sunucu/kullanıcı/parola yapılandırılmamış")
        self.full_fetch_max_bytes = full_fetch_max_bytes
        self.body_max_chars = body_max_chars
        self.keep_payload_max = keep_payload_max
        self._current: str | None = None
        self.info = SourceInfo(kind="imap", host=host)
        try:
            import imapclient
            from imapclient.exceptions import LoginError

            ctx = _ssl_context or ssl.create_default_context()  # testler dışında daima doğrulamalı
            if security == "ssl":
                raw = imapclient.IMAPClient(host, port=port, ssl=True, ssl_context=ctx, timeout=timeout)
            else:
                raw = imapclient.IMAPClient(host, port=port, ssl=False, timeout=timeout)
                raw.starttls(ssl_context=ctx)
            self.client = ReadOnlyIMAP(raw)
            caps = [_b(c) for c in self.client.capabilities()]
            if "LOGINDISABLED" in caps:
                raise SourceAuthError("Sunucu bu bağlantıda LOGIN'e izin vermiyor")
            try:
                self.client.login(username, password)
            except LoginError as e:
                raise SourceAuthError("IMAP kimlik doğrulaması başarısız") from e
            self.info.capabilities = [_b(c) for c in self.client.capabilities()]
        except SourceError:
            raise
        except (OSError, ssl.SSLError) as e:
            raise SourceError(f"IMAP bağlantı hatası: {type(e).__name__}") from e

    def list_folders(self) -> list[FolderInfo]:
        out = []
        for flags, delim, name in self.client.list_folders():
            fl = [_b(f) for f in flags]
            out.append(FolderInfo(name=_b(name), delimiter=_b(delim) or None, flags=fl,
                                  selectable="\\Noselect" not in fl and "\\NonExistent" not in fl))
        return out

    def open_folder(self, name: str) -> FolderStatus:
        try:
            st = self.client.examine(name)
        except Exception as e:
            raise SourceError(f"Klasör açılamadı: {type(e).__name__}") from e
        self._current = name
        return FolderStatus(uidvalidity=int(st[b"UIDVALIDITY"]), exists=int(st.get(b"EXISTS", 0)),
                            uidnext=int(st[b"UIDNEXT"]) if b"UIDNEXT" in st else None)

    def search_uids(self, since: date | None) -> list[int]:
        crit = ["SINCE", since] if since else ["ALL"]
        return sorted(int(u) for u in self.client.search(crit))

    def fetch_flags(self, uids: list[int]) -> dict[int, list[str]]:
        if not uids:
            return {}
        res = self.client.fetch(uids, ["FLAGS"])
        return {int(u): [_b(f) for f in d.get(b"FLAGS", ())] for u, d in res.items()}

    def fetch(self, uids: list[int]) -> Iterator[FetchedMessage]:
        if not uids:
            return
        meta = self.client.fetch(uids, ["RFC822.SIZE", "FLAGS", "BODYSTRUCTURE"])
        small = [u for u in uids if u in meta and int(meta[u].get(b"RFC822.SIZE", 0)) <= self.full_fetch_max_bytes]
        full = self.client.fetch(small, ["BODY.PEEK[]"]) if small else {}
        for uid in uids:
            if uid not in meta:
                continue  # sunucudan bu arada silinmiş
            flags = [_b(f) for f in meta[uid].get(b"FLAGS", ())]
            size = int(meta[uid].get(b"RFC822.SIZE", 0)) or None
            try:
                if uid in full:
                    raw = full[uid].get(b"BODY[]") or b""
                    parsed = parse_rfc822(raw, body_max_chars=self.body_max_chars,
                                          keep_payload_max=self.keep_payload_max)
                else:
                    parsed = self._fetch_partial(uid, meta[uid].get(b"BODYSTRUCTURE"), size)
                yield FetchedMessage(uid=uid, flags=flags, parsed=parsed)
            except (OSError, ssl.SSLError) as e:
                raise SourceError(f"Bağlantı koptu: {type(e).__name__}") from e
            except Exception as e:  # ayrıştırma hatası: tek maili etkiler, döngüyü değil
                log.warning("mail ayrıştırılamadı uid=%s hata=%s", uid, type(e).__name__)
                yield FetchedMessage(uid=uid, flags=flags, parsed=None, error=type(e).__name__)

    def _fetch_partial(self, uid: int, bs, size: int | None) -> ParsedMessage:
        parts = list(walk_bodystructure(bs)) if bs is not None else []
        text_parts = [p for p in parts if p["ctype"] in ("text/plain", "text/html") and not _is_att_part(p)]
        keys = ["BODY.PEEK[HEADER]"] + [f"BODY.PEEK[{p['section']}]" for p in text_parts[:4]]
        res = self.client.fetch([uid], keys).get(uid, {})
        header = res.get(b"BODY[HEADER]") or b""
        texts = []
        for p in text_parts[:4]:
            data = res.get(f"BODY[{p['section']}]".encode()) or b""
            texts.append((p["ctype"], decode_bytes(decode_transfer(data, p["encoding"]), p["charset"])))
        atts = [
            ParsedAttachment(part_index=i, imap_section=p["section"], filename=p["filename"] or f"ek-{i}",
                             content_type=p["ctype"], size=p["size"], content_id=p["content_id"],
                             is_inline=p["disposition"] == "inline" and bool(p["content_id"]))
            for i, p in enumerate(parts) if _is_att_part(p)
        ]
        return parse_partial(header, texts, atts, size=size, body_max_chars=self.body_max_chars)

    def fetch_section(self, folder: str, uidvalidity: int, uid: int, section: str) -> tuple[bytes, str]:
        st = self.open_folder(folder)
        if st.uidvalidity != uidvalidity:
            raise SourceError("Klasörün UIDVALIDITY değeri değişmiş; mail yeniden senkronlanmalı")
        res = self.client.fetch([uid], ["BODYSTRUCTURE", f"BODY.PEEK[{section}]"]).get(uid)
        if not res:
            raise KeyError("mail sunucuda bulunamadı")
        part = next((p for p in walk_bodystructure(res[b"BODYSTRUCTURE"]) if p["section"] == section), None)
        if part is None:
            raise KeyError("ek bölümü bulunamadı")
        data = res.get(f"BODY[{section}]".encode()) or b""
        return decode_transfer(data, part["encoding"]), part["ctype"]

    def close(self) -> None:
        try:
            self.client.logout()
        except Exception:  # noqa: S110 - kapanışta hata önemsiz
            pass


# =================================================================== dosya kaynakları


class EmlDirSource:
    """Klasör ağacı → posta klasörleri. Her alt dizin bir klasör, içindeki *.eml dosyaları mailler.

    Outlook for Mac: bir klasördeki mailleri seçip Finder'a sürüklemek .eml üretir.
    UID'ler dosya adına göre sıralı ve kararlıdır (yalnızca yeni dosya eklenirse).
    """

    def __init__(self, root: str | Path, *, folder_prefix: str = "", kind: str = "import",
                 body_max_chars: int = 200_000, keep_payload_max: int = 0):
        self.root = Path(root).resolve()
        if not self.root.is_dir():
            raise SourceError(f"Dizin bulunamadı: {self.root}")
        self.prefix = folder_prefix
        self.body_max_chars = body_max_chars
        self.keep_payload_max = keep_payload_max
        self.info = SourceInfo(kind=kind)
        self._files: list[Path] = []
        self._folder: str | None = None

    def _dir_for(self, name: str) -> Path:
        rel = name[len(self.prefix):] if self.prefix and name.startswith(self.prefix) else name
        if rel == "INBOX" and not (self.root / "INBOX").is_dir():
            return self.root
        p = (self.root / rel).resolve()
        if self.root not in p.parents and p != self.root:
            raise SourceError("Geçersiz klasör yolu")
        return p

    def list_folders(self) -> list[FolderInfo]:
        out = []
        for dirpath, _dirs, files in sorted(os.walk(self.root)):
            if any(f.lower().endswith(".eml") for f in files):
                rel = Path(dirpath).relative_to(self.root).as_posix()
                if rel == ".":
                    rel = "INBOX"
                flags = []
                if rel.lower() in ("sent", "gönderilen", "gönderilmiş öğeler"):
                    flags.append("\\Sent")
                out.append(FolderInfo(name=self.prefix + rel, delimiter="/", flags=flags))
        return out

    def open_folder(self, name: str) -> FolderStatus:
        d = self._dir_for(name)
        self._files = sorted(p for p in d.iterdir() if p.suffix.lower() == ".eml")
        self._folder = name
        uv_file = d / ".uidvalidity"
        uv = int(uv_file.read_text().strip()) if uv_file.is_file() else (zlib.crc32(str(d).encode()) or 1)
        return FolderStatus(uidvalidity=uv, exists=len(self._files), uidnext=len(self._files) + 1)

    def search_uids(self, since: date | None) -> list[int]:
        return list(range(1, len(self._files) + 1))

    def _read(self, uid: int) -> bytes:
        return self._files[uid - 1].read_bytes()

    def fetch_flags(self, uids: list[int]) -> dict[int, list[str]]:
        return {u: self._flags(self._read(u)) for u in uids if 0 < u <= len(self._files)}

    @staticmethod
    def _flags(raw: bytes) -> list[str]:
        head = raw[:4000].decode("utf-8", "replace")
        for line in head.splitlines():
            if line.lower().startswith("x-fm-demo-flags:"):
                return line.split(":", 1)[1].split()
            if not line.strip():
                break
        return []

    def fetch(self, uids: list[int]) -> Iterator[FetchedMessage]:
        for uid in uids:
            if not 0 < uid <= len(self._files):
                continue
            raw = self._read(uid)
            try:
                parsed = parse_rfc822(raw, body_max_chars=self.body_max_chars, keep_payload_max=self.keep_payload_max)
                yield FetchedMessage(uid=uid, flags=self._flags(raw), parsed=parsed)
            except Exception as e:
                yield FetchedMessage(uid=uid, flags=[], parsed=None, error=type(e).__name__)

    def fetch_section(self, folder: str, uidvalidity: int, uid: int, section: str) -> tuple[bytes, str]:
        st = self.open_folder(folder)
        if st.uidvalidity != uidvalidity:
            raise SourceError("Klasör değişmiş")
        return extract_section(self._read(uid), section)

    def close(self) -> None:
        pass


class MboxSource:
    """Tek bir mbox dosyasını tek klasör olarak sunar (Thunderbird / readpst çıktısı)."""

    def __init__(self, path: str | Path, folder_name: str, *, body_max_chars: int = 200_000,
                 keep_payload_max: int = 0):
        self.path = Path(path).resolve()
        if not self.path.is_file():
            raise SourceError(f"mbox bulunamadı: {self.path}")
        self.folder_name = folder_name
        self.body_max_chars = body_max_chars
        self.keep_payload_max = keep_payload_max
        self.info = SourceInfo(kind="import")
        self._box = mailbox.mbox(str(self.path), create=False)
        self._keys = list(self._box.keys())

    def list_folders(self) -> list[FolderInfo]:
        return [FolderInfo(name=self.folder_name, delimiter="/", flags=[])]

    def open_folder(self, name: str) -> FolderStatus:
        if name != self.folder_name:
            raise SourceError("Bilinmeyen klasör")
        return FolderStatus(uidvalidity=zlib.crc32(str(self.path).encode()) or 1, exists=len(self._keys))

    def search_uids(self, since: date | None) -> list[int]:
        return list(range(1, len(self._keys) + 1))

    def _read(self, uid: int) -> bytes:
        return self._box.get_bytes(self._keys[uid - 1])

    def fetch_flags(self, uids: list[int]) -> dict[int, list[str]]:
        return {u: [] for u in uids}

    def fetch(self, uids: list[int]) -> Iterator[FetchedMessage]:
        for uid in uids:
            if not 0 < uid <= len(self._keys):
                continue
            try:
                parsed = parse_rfc822(self._read(uid), body_max_chars=self.body_max_chars,
                                      keep_payload_max=self.keep_payload_max)
                yield FetchedMessage(uid=uid, flags=[], parsed=parsed)
            except Exception as e:
                yield FetchedMessage(uid=uid, flags=[], parsed=None, error=type(e).__name__)

    def fetch_section(self, folder: str, uidvalidity: int, uid: int, section: str) -> tuple[bytes, str]:
        return extract_section(self._read(uid), section)

    def close(self) -> None:
        self._box.close()
