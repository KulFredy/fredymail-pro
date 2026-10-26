"""Yapılandırılmış log. Mail gövdesi, parola veya token loglanmaz:
- uygulama kodu loglara yalnızca kimlik/sayı yazar,
- `RedactFilter` yanlışlıkla sızabilecek sır kalıplarını maskeler,
- imaplib/httpx hata ayıklama çıktısı kapalıdır.
"""

from __future__ import annotations

import json
import logging
import re
import sys
from datetime import UTC, datetime

_SECRET_PATTERNS = [
    (re.compile(r"(?i)(password|parola|passwd|secret|token|api[_-]?key|authorization)(\"?\s*[:=]\s*\"?)([^\s\",]+)"),
     r"\1\2***"),
    (re.compile(r"(?i)bearer\s+[a-z0-9._\-]+"), "Bearer ***"),
    (re.compile(r"sk-[A-Za-z0-9_\-]{8,}"), "sk-***"),
    (re.compile(r"(postgres(?:ql)?(?:\+\w+)?://[^:/\s]+:)[^@\s]+@"), r"\1***@"),
]


def scrub(text: str) -> str:
    for rx, rep in _SECRET_PATTERNS:
        text = rx.sub(rep, text)
    return text


class RedactFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            msg = record.getMessage()
        except Exception:
            return True
        record.msg = scrub(msg)
        record.args = ()
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        out = {"ts": datetime.now(UTC).isoformat(timespec="seconds"), "level": record.levelname,
               "logger": record.name, "msg": record.getMessage()}
        if record.exc_info:
            out["exc"] = scrub(self.formatException(record.exc_info))[-2000:]
        return json.dumps(out, ensure_ascii=False)


def setup_logging(level: str = "INFO") -> None:
    root = logging.getLogger()
    if getattr(root, "_fm_configured", False):
        return
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(JsonFormatter())
    h.addFilter(RedactFilter())
    root.handlers = [h]
    root.setLevel(level.upper())
    for noisy in ("imapclient", "imaplib", "httpx", "httpcore", "uvicorn.access"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    for very_noisy in ("pypdf", "openpyxl", "sqlalchemy"):
        logging.getLogger(very_noisy).setLevel(logging.ERROR)
    root._fm_configured = True  # type: ignore[attr-defined]
