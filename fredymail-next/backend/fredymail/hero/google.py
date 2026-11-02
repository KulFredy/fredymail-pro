"""Google Drive / Sheets için küçük istemci (servis hesabı, JWT). Ek bağımlılık yok: imza `cryptography` ile.

Servis hesabı yalnızca kendisiyle paylaşılan dosyaları görür. Kapsamlar: Drive salt okunur + Sheets.
Anahtar dosyası (`FM_GOOGLE_SA_FILE`) hiçbir yere yazılmaz ve loglanmaz.
"""

from __future__ import annotations

import base64
import json
import time
from pathlib import Path
from urllib.parse import quote

import httpx

SCOPES = "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets"
DRIVE = "https://www.googleapis.com/drive/v3"
SHEETS = "https://sheets.googleapis.com/v4/spreadsheets"
SHEET_MIME = "application/vnd.google-apps.spreadsheet"
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class GoogleError(Exception):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def sign_jwt(sa: dict, now: int | None = None, scopes: str = SCOPES) -> str:
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    now = int(now if now is not None else time.time())
    header = {"alg": "RS256", "typ": "JWT", "kid": sa.get("private_key_id", "")}
    claims = {"iss": sa["client_email"], "scope": scopes, "aud": sa["token_uri"], "iat": now, "exp": now + 3600}
    signing_input = f"{_b64(json.dumps(header).encode())}.{_b64(json.dumps(claims).encode())}"
    key = serialization.load_pem_private_key(sa["private_key"].encode(), password=None)
    sig = key.sign(signing_input.encode(), padding.PKCS1v15(), hashes.SHA256())  # type: ignore[union-attr]
    return f"{signing_input}.{_b64(sig)}"


def load_service_account(path: str) -> dict:
    p = Path(path)
    if not p.is_file():
        raise GoogleError(f"servis hesabı anahtarı bulunamadı ({path})")
    try:
        sa = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise GoogleError("servis hesabı anahtarı okunamadı (geçerli JSON değil)") from e
    for k in ("client_email", "private_key", "token_uri"):
        if not sa.get(k):
            raise GoogleError(f"servis hesabı anahtarında '{k}' eksik")
    return sa


class GoogleClient:
    def __init__(self, sa: dict, http: httpx.Client | None = None):
        self.sa = sa
        self.email = sa["client_email"]
        self.http = http or httpx.Client(timeout=30)
        self._token: str | None = None
        self._token_exp = 0.0

    @classmethod
    def from_file(cls, path: str, http: httpx.Client | None = None) -> GoogleClient:
        return cls(load_service_account(path), http)

    def _access_token(self) -> str:
        if self._token and time.time() < self._token_exp - 60:
            return self._token
        r = self.http.post(self.sa["token_uri"], data={
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": sign_jwt(self.sa)})
        if r.status_code != 200:
            raise GoogleError(f"Google kimlik doğrulaması başarısız (HTTP {r.status_code}): {_err(r)}", r.status_code)
        body = r.json()
        self._token = body["access_token"]
        self._token_exp = time.time() + int(body.get("expires_in", 3600))
        return self._token

    def _req(self, method: str, url: str, **kw) -> httpx.Response:
        headers = {"Authorization": f"Bearer {self._access_token()}"}
        r = self.http.request(method, url, headers=headers, **kw)
        if r.status_code >= 400:
            hint = ""
            if r.status_code in (403, 404):
                hint = f" — dosya {self.email} adresiyle paylaşıldı mı?"
            raise GoogleError(f"Google API hatası (HTTP {r.status_code}): {_err(r)}{hint}", r.status_code)
        return r

    # ---------------------------------------------------------------- Drive

    def file_meta(self, file_id: str) -> dict:
        return self._req("GET", f"{DRIVE}/files/{quote(file_id)}", params={
            "fields": "id,name,mimeType,modifiedTime", "supportsAllDrives": "true"}).json()

    def download_xlsx(self, file_id: str) -> tuple[bytes, dict]:
        """Drive'daki xlsx'i indirir; dosya yerel Google Sheets ise xlsx olarak dışa aktarır."""
        meta = self.file_meta(file_id)
        if meta.get("mimeType") == SHEET_MIME:
            r = self._req("GET", f"{DRIVE}/files/{quote(file_id)}/export", params={"mimeType": XLSX_MIME})
        else:
            r = self._req("GET", f"{DRIVE}/files/{quote(file_id)}",
                          params={"alt": "media", "supportsAllDrives": "true"})
        return r.content, meta

    def oldest_revision_since(self, file_id: str, not_after: str) -> dict | None:
        """`not_after` (RFC3339) tarihinden önceki en yeni sürüm; yoksa en eski sürüm. Yerel Sheets dosyası için None.

        Drive, ikili dosyaların eski sürümlerini sınırlı süre (genelde 30 gün / 100 sürüm) tutar.
        """
        revs, token = [], None
        while True:
            params = {"fields": "nextPageToken,revisions(id,modifiedTime)", "pageSize": "200"}
            if token:
                params["pageToken"] = token
            body = self._req("GET", f"{DRIVE}/files/{quote(file_id)}/revisions", params=params).json()
            revs += body.get("revisions", [])
            token = body.get("nextPageToken")
            if not token:
                break
        if len(revs) < 2:
            return None
        revs.sort(key=lambda r: r["modifiedTime"])
        older = [r for r in revs[:-1] if r["modifiedTime"] <= not_after]
        return older[-1] if older else revs[0]

    def download_revision(self, file_id: str, revision_id: str) -> bytes:
        return self._req("GET", f"{DRIVE}/files/{quote(file_id)}/revisions/{quote(revision_id)}",
                         params={"alt": "media"}).content

    # ---------------------------------------------------------------- Sheets

    def sheet_grid(self, spreadsheet_id: str, a1_range: str) -> dict:
        fields = ("properties.title,sheets(properties(sheetId,title,index),"
                  "data(startRow,startColumn,rowData(values(formattedValue,hyperlink,userEnteredValue,"
                  "textFormatRuns))))")
        return self._req("GET", f"{SHEETS}/{quote(spreadsheet_id)}", params={
            "ranges": a1_range, "includeGridData": "true", "fields": fields}).json()

    def sheet_titles(self, spreadsheet_id: str) -> list[dict]:
        r = self._req("GET", f"{SHEETS}/{quote(spreadsheet_id)}",
                      params={"fields": "sheets(properties(sheetId,title,index))"}).json()
        return [s["properties"] for s in r.get("sheets", [])]

    def batch_update(self, spreadsheet_id: str, requests: list[dict]) -> dict:
        return self._req("POST", f"{SHEETS}/{quote(spreadsheet_id)}:batchUpdate",
                         json={"requests": requests}).json()


def _err(r: httpx.Response) -> str:
    try:
        body = r.json()
        e = body.get("error")
        if isinstance(e, dict):
            return str(e.get("message", ""))[:300]
        return str(body.get("error_description") or e or "")[:300]
    except ValueError:
        return r.text[:200]
