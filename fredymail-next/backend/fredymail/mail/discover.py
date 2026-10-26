"""Posta sağlayıcısı ve güvenli kimlik doğrulama yönteminin keşfi.

Tahminle sunucu adresi girilmez: aday sunucular DNS (MX, SRV RFC 6186), Mozilla autoconfig
ve ISPDB kayıtlarından toplanır; her aday için giriş YAPMADAN TLS sertifikası ve IMAP
yetenekleri (CAPABILITY, AUTH=...) okunur. İsteğe bağlı `--login` adımı yalnızca salt okunur
klasör listesi ve STATUS sayıları alır.
"""

from __future__ import annotations

import socket
import ssl
import xml.etree.ElementTree as ET  # noqa: S405 - yalnızca autoconfig XML, boyut sınırlı
from dataclasses import dataclass, field

import httpx


@dataclass
class Candidate:
    host: str
    port: int
    security: str  # ssl | starttls
    source: str


@dataclass
class ProbeResult:
    candidate: Candidate
    reachable: bool = False
    tls_ok: bool = False
    cert_subject: str = ""
    cert_issuer: str = ""
    cert_names: list[str] = field(default_factory=list)
    cert_not_after: str = ""
    capabilities: list[str] = field(default_factory=list)
    auth_methods: list[str] = field(default_factory=list)
    greeting: str = ""
    error: str = ""


def dns_candidates(domain: str) -> tuple[list[str], list[Candidate]]:
    import dns.resolver

    notes: list[str] = []
    cands: list[Candidate] = []
    try:
        mx = sorted(dns.resolver.resolve(domain, "MX", lifetime=8), key=lambda r: r.preference)
        notes += [f"MX {r.preference} {str(r.exchange).rstrip('.')}" for r in mx]
        for r in mx[:3]:
            host = str(r.exchange).rstrip(".")
            cands.append(Candidate(host, 993, "ssl", "MX"))
    except Exception as e:
        notes.append(f"MX sorgusu başarısız: {type(e).__name__}")
    for svc, sec in (("_imaps._tcp", "ssl"), ("_imap._tcp", "starttls")):
        try:
            for r in dns.resolver.resolve(f"{svc}.{domain}", "SRV", lifetime=8):
                t = str(r.target).rstrip(".")
                if t:
                    notes.append(f"SRV {svc} → {t}:{r.port}")
                    cands.append(Candidate(t, int(r.port), sec, f"SRV {svc}"))
        except Exception:
            notes.append(f"SRV {svc} kaydı yok")
    for txt_name in (domain,):
        try:
            for r in dns.resolver.resolve(txt_name, "TXT", lifetime=8):
                t = b"".join(r.strings).decode("utf-8", "replace")
                if t.startswith("v=spf1"):
                    notes.append(f"SPF: {t[:200]}")
        except Exception:  # noqa: S110
            pass
    return notes, cands


def autoconfig_candidates(email: str, domain: str) -> tuple[list[str], list[Candidate]]:
    notes, cands = [], []
    urls = [
        f"https://autoconfig.{domain}/mail/config-v1.1.xml?emailaddress={email}",
        f"https://{domain}/.well-known/autoconfig/mail/config-v1.1.xml",
        f"https://autoconfig.thunderbird.net/v1.1/{domain}",
    ]
    for url in urls:
        try:
            r = httpx.get(url, timeout=8, follow_redirects=True)
        except httpx.HTTPError as e:
            notes.append(f"autoconfig {url.split('/')[2]}: {type(e).__name__}")
            continue
        if r.status_code != 200 or len(r.content) > 200_000 or b"<clientConfig" not in r.content:
            notes.append(f"autoconfig {url.split('/')[2]}: yok (HTTP {r.status_code})")
            continue
        try:
            root = ET.fromstring(r.content)  # noqa: S314
        except ET.ParseError:
            continue
        for srv in root.iter("incomingServer"):
            if srv.get("type") != "imap":
                continue
            host = (srv.findtext("hostname") or "").replace("%EMAILDOMAIN%", domain)
            port = int(srv.findtext("port") or 993)
            st = (srv.findtext("socketType") or "").upper()
            auth = srv.findtext("authentication") or ""
            notes.append(f"autoconfig {url.split('/')[2]} → {host}:{port} {st} auth={auth}")
            if st in ("SSL", "STARTTLS"):
                cands.append(Candidate(host, port, "ssl" if st == "SSL" else "starttls", "autoconfig"))
    return notes, cands


def probe(c: Candidate, timeout: float = 10) -> ProbeResult:
    """Giriş yapmadan TLS + IMAP CAPABILITY okur."""
    res = ProbeResult(candidate=c)
    ctx = ssl.create_default_context()
    try:
        raw = socket.create_connection((c.host, c.port), timeout=timeout)
        res.reachable = True
    except OSError as e:
        res.error = f"bağlanılamadı: {type(e).__name__}"
        return res
    try:
        if c.security == "ssl":
            sock = ctx.wrap_socket(raw, server_hostname=c.host)
            f = sock.makefile("rb")
            res.greeting = f.readline(2000).decode("utf-8", "replace").strip()
        else:
            f = raw.makefile("rb")
            res.greeting = f.readline(2000).decode("utf-8", "replace").strip()
            raw.sendall(b"a1 STARTTLS\r\n")
            line = f.readline(2000)
            if b"a1 OK" not in line:
                res.error = "STARTTLS desteklenmiyor"
                return res
            sock = ctx.wrap_socket(raw, server_hostname=c.host)
            f = sock.makefile("rb")
        res.tls_ok = True
        cert = sock.getpeercert() or {}
        res.cert_subject = ", ".join("=".join(x) for t in cert.get("subject", ()) for x in t)
        res.cert_issuer = ", ".join("=".join(x) for t in cert.get("issuer", ()) for x in t)
        res.cert_names = [v for k, v in cert.get("subjectAltName", ()) if k == "DNS"][:20]
        res.cert_not_after = cert.get("notAfter", "")
        sock.sendall(b"a2 CAPABILITY\r\n")
        caps: list[str] = []
        for _ in range(20):
            line = f.readline(8000).decode("utf-8", "replace").strip()
            if line.upper().startswith("* CAPABILITY"):
                caps = line.split()[2:]
            if line.startswith("a2 "):
                break
        res.capabilities = caps
        res.auth_methods = [x.split("=", 1)[1] for x in caps if x.upper().startswith("AUTH=")]
        sock.sendall(b"a3 LOGOUT\r\n")
        sock.close()
    except ssl.SSLCertVerificationError as e:
        res.error = f"TLS sertifikası doğrulanamadı: {e.verify_message}"
    except (OSError, ssl.SSLError) as e:
        res.error = f"TLS/IMAP hatası: {type(e).__name__}"
    return res


def discover(email: str, extra_hosts: list[str] | None = None) -> dict:
    domain = email.split("@", 1)[1].lower()
    notes1, c1 = dns_candidates(domain)
    notes2, c2 = autoconfig_candidates(email, domain)
    cands = c1 + c2
    for h in extra_hosts or []:
        cands.append(Candidate(h, 993, "ssl", "kullanıcı tarafından verilen"))
        cands.append(Candidate(h, 143, "starttls", "kullanıcı tarafından verilen"))
    seen, uniq = set(), []
    for c in cands:
        k = (c.host.lower(), c.port)
        if k not in seen:
            seen.add(k)
            uniq.append(c)
    probes = [probe(c) for c in uniq]
    good = [p for p in probes if p.tls_ok and p.capabilities]
    rec = None
    if good:
        best = sorted(good, key=lambda p: (p.candidate.security != "ssl", p.candidate.source != "SRV _imaps._tcp"))[0]
        auth = best.auth_methods
        method = ("OAUTH2 (XOAUTH2)" if any(a.upper() in ("XOAUTH2", "OAUTHBEARER") for a in auth)
                  else "parola (PLAIN/LOGIN) — yalnızca TLS üzerinden; mümkünse uygulama parolası")
        software = "bilinmiyor"
        g = best.greeting.lower()
        for key, name in (("icewarp", "IceWarp"), ("dovecot", "Dovecot"), ("exchange", "Microsoft Exchange"),
                          ("zimbra", "Zimbra"), ("courier", "Courier"), ("cyrus", "Cyrus"), ("gimap", "Gmail")):
            if key in g or any(key in c.lower() for c in best.capabilities):
                software = name
        rec = {"host": best.candidate.host, "port": best.candidate.port, "security": best.candidate.security,
               "auth": method, "server_software": software,
               "supports": {k: k in best.capabilities for k in ("IDLE", "CONDSTORE", "QRESYNC", "SPECIAL-USE",
                                                                "UIDPLUS", "MOVE")}}
    return {"email": email, "domain": domain, "notes": notes1 + notes2,
            "probes": [p.__dict__ | {"candidate": p.candidate.__dict__} for p in probes], "recommendation": rec}


def folder_plan(source, settings) -> list[dict]:
    """Giriş yapılmış salt okunur kaynakla klasör bazında ilk senkron kapsamını hesaplar."""
    from .sync import folder_is_default_enabled

    since = settings.since_date()
    out = []
    for info in source.list_folders():
        row = {"name": info.name, "role": info.role, "flags": info.flags, "selectable": info.selectable,
               "enabled": folder_is_default_enabled(info, settings), "total": None, "in_scope": None}
        if info.selectable:
            try:
                st = source.open_folder(info.name)
                row["total"] = st.exists
                if row["enabled"]:
                    n = len(source.search_uids(since)) if st.exists else 0
                    row["in_scope"] = min(n, settings.sync_max_messages_per_folder)
            except Exception as e:
                row["error"] = type(e).__name__
        out.append(row)
    return out
