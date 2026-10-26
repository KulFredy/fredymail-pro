from __future__ import annotations

from collections.abc import Iterator
from functools import lru_cache

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..db import new_session
from ..models import Folder
from ..search.meili import Meili
from ..security.auth import COOKIE_NAME, validate_session


def get_db() -> Iterator[Session]:
    db = new_session()
    try:
        yield db
    finally:
        db.close()


@lru_cache
def _meili() -> Meili:
    return Meili(get_settings())


def get_meili() -> Meili:
    return _meili()


def require_user(request: Request, db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    s = validate_session(db, settings, request.cookies.get(COOKIE_NAME))
    if s is None:
        raise HTTPException(status_code=401, detail="Oturum gerekli")
    return s


def source_for_folder(folder: Folder, settings: Settings):
    """Ek indirme vb. için klasörün kaynağını açar (salt okunur)."""
    from pathlib import Path

    from ..mail.source import EmlDirSource, ImapSource, MboxSource

    if folder.origin == "server":
        return ImapSource(host=settings.imap_host, port=settings.imap_port, security=settings.imap_security,
                          username=settings.imap_username or settings.account_email,
                          password=settings.imap_password, timeout=settings.imap_timeout_seconds)
    if not folder.source_path:
        raise HTTPException(status_code=410, detail="İçe aktarılan dosya artık mevcut değil")
    p = Path(folder.source_path)
    if p.is_file():
        return MboxSource(p, folder.name)
    prefix = ""
    if folder.origin == "import" and "/" in folder.name:
        prefix = folder.name.split("/", 1)[0] + "/"
    return EmlDirSource(p, folder_prefix=prefix, kind=folder.origin)
