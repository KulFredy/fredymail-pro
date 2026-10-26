from __future__ import annotations

import logging
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import __version__
from ..config import Settings, get_settings
from ..db import db_ok
from ..logging_setup import setup_logging
from ..models import AiRun, Folder, KeyValue, Message
from ..security.auth import (
    COOKIE_NAME,
    check_credentials,
    client_ip,
    create_session,
    destroy_session,
    is_rate_limited,
    record_attempt,
    validate_session,
)
from . import ai_routes, push_routes, routes
from .deps import get_db, get_meili

log = logging.getLogger("fredymail.api")

APP_CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
           "font-src 'self' data:; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; "
           "base-uri 'none'; form-action 'self'; object-src 'none'")
UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}


class LoginIn(BaseModel):
    username: str = Field(max_length=100)
    password: str = Field(max_length=500)
    totp: str | None = Field(default=None, max_length=10)


def create_app() -> FastAPI:
    settings = get_settings()
    setup_logging(settings.log_level)
    if settings.env == "production":
        missing = [n for n, v in (("FM_ADMIN_PASSWORD_HASH", settings.admin_password_hash),
                                  ("FM_SESSION_SECRET", settings.session_secret)) if not v]
        if missing:
            raise RuntimeError("Eksik zorunlu ayar: " + ", ".join(missing))
        if len(settings.session_secret) < 32:
            raise RuntimeError("FM_SESSION_SECRET en az 32 karakter olmalı")

    app = FastAPI(title="FredyMail", version=__version__, docs_url=None, redoc_url=None, openapi_url=None)

    if settings.origins:
        app.add_middleware(CORSMiddleware, allow_origins=settings.origins, allow_credentials=True,
                           allow_methods=["GET", "POST", "PATCH", "DELETE"],
                           allow_headers=["Content-Type", "X-Requested-With"])

    @app.middleware("http")
    async def security(request: Request, call_next):
        # CSRF: durum değiştiren isteklerde Origin aynı site (veya izinli) olmalı + özel başlık zorunlu
        if request.method in UNSAFE and request.url.path.startswith("/api/"):
            origin = request.headers.get("origin") or request.headers.get("referer") or ""
            host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
            o = urlparse(origin)
            ok_origin = bool(origin) and (o.netloc == host or f"{o.scheme}://{o.netloc}" in settings.origins)
            if not ok_origin or request.headers.get("x-requested-with") != "fredymail":
                return JSONResponse({"detail": "İstek kaynağı doğrulanamadı (CSRF koruması)"}, status_code=403)
        resp: Response = await call_next(request)
        resp.headers.setdefault("Content-Security-Policy", APP_CSP)
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("Referrer-Policy", "no-referrer")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        resp.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()")
        resp.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        if settings.cookie_secure:
            resp.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
        if request.url.path.startswith("/api/"):
            resp.headers.setdefault("Cache-Control", "no-store")
        return resp

    # ---------------------------------------------------------------- sağlık (anonim, ayrıntısız)

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.get("/api/health/ready")
    def ready():
        ok_db = db_ok()
        ok_meili = get_meili().healthy()
        # Meilisearch kapalıyken de uygulama hizmet verir (yedek arama) → hazır sayılır
        return JSONResponse({"database": ok_db, "search": ok_meili}, status_code=200 if ok_db else 503)

    # ---------------------------------------------------------------- kimlik doğrulama

    @app.post("/api/auth/login")
    def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
        ip = client_ip(settings, request.headers, request.client.host if request.client else None)
        if is_rate_limited(db, settings, ip):
            raise HTTPException(429, "Çok fazla başarısız deneme. Lütfen biraz sonra tekrar deneyin.")
        if not check_credentials(settings, body.username, body.password, body.totp):
            record_attempt(db, ip, False)
            log.warning("başarısız giriş denemesi ip=%s", ip)
            raise HTTPException(401, "Kullanıcı adı, parola veya doğrulama kodu hatalı")
        record_attempt(db, ip, True)
        token = create_session(db, settings, ip, request.headers.get("user-agent", ""))
        response.set_cookie(COOKIE_NAME, token, httponly=True, secure=settings.cookie_secure, samesite="strict",
                            max_age=settings.session_absolute_hours * 3600, path="/")
        return {"ok": True, "user": settings.admin_user, "totp_required": bool(settings.totp_secret)}

    @app.post("/api/auth/logout")
    def logout(request: Request, response: Response, db: Session = Depends(get_db)):
        destroy_session(db, settings, request.cookies.get(COOKIE_NAME))
        response.delete_cookie(COOKIE_NAME, path="/")
        return {"ok": True}

    @app.get("/api/auth/me")
    def me(request: Request, db: Session = Depends(get_db)):
        s = validate_session(db, settings, request.cookies.get(COOKIE_NAME))
        if s is None:
            # 200: oturum yokluğu bir hata değil; tarayıcı konsolunu kirletmez
            return {"authenticated": False, "totp_required": bool(settings.totp_secret)}
        return {"authenticated": True, "user": settings.admin_user, "account": settings.account_email,
                "expires_at": s.expires_at.isoformat()}

    # ---------------------------------------------------------------- metrikler (Prometheus metni)

    @app.get("/api/metrics")
    def metrics(request: Request, db: Session = Depends(get_db), s: Settings = Depends(get_settings)):
        peer = request.client.host if request.client else ""
        is_local = peer in ("127.0.0.1", "::1") and "cf-connecting-ip" not in request.headers
        if not is_local and validate_session(db, s, request.cookies.get(COOKIE_NAME)) is None:
            raise HTTPException(401, "Oturum gerekli")
        total = db.execute(select(func.count()).select_from(Message)).scalar_one()
        dirty = db.execute(select(func.count()).select_from(Message).where(Message.index_dirty.is_(True))).scalar_one()
        errors = db.execute(select(func.count()).select_from(Folder).where(Folder.status == "error")).scalar_one()
        start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
        cost = db.execute(select(func.coalesce(func.sum(AiRun.cost_usd), 0.0)).where(AiRun.created_at >= start)).scalar_one()
        hb = db.get(KeyValue, "worker")
        age = -1.0
        if hb is not None and hb.value.get("at"):
            age = (datetime.now(UTC) - datetime.fromisoformat(hb.value["at"])).total_seconds()
        lines = [
            "# TYPE fredymail_messages_total gauge", f"fredymail_messages_total {total}",
            "# TYPE fredymail_index_pending gauge", f"fredymail_index_pending {dirty}",
            "# TYPE fredymail_folders_in_error gauge", f"fredymail_folders_in_error {errors}",
            "# TYPE fredymail_worker_heartbeat_age_seconds gauge", f"fredymail_worker_heartbeat_age_seconds {age:.0f}",
            "# TYPE fredymail_ai_cost_today_usd gauge", f"fredymail_ai_cost_today_usd {float(cost):.4f}",
            "# TYPE fredymail_search_up gauge", f"fredymail_search_up {int(get_meili().healthy())}",
        ]
        return PlainTextResponse("\n".join(lines) + "\n")

    app.include_router(routes.router)
    app.include_router(ai_routes.router)
    app.include_router(push_routes.router)

    @app.get("/api/{rest:path}")
    def api_404(rest: str):
        raise HTTPException(404, "Bulunamadı")

    # ---------------------------------------------------------------- arayüz (SPA)

    static = Path(settings.static_dir)
    if static.is_dir():
        index = static / "index.html"

        @app.get("/{path:path}")
        def spa(path: str):
            f = (static / path).resolve()
            if path and f.is_file() and static.resolve() in f.parents:
                headers = {"Cache-Control": "public, max-age=31536000, immutable"} if "/assets/" in f"/{path}" else {}
                if path in ("sw.js", "manifest.webmanifest"):
                    headers = {"Cache-Control": "no-cache"}  # bildirim çalışanı güncellemeleri hemen alınsın
                media = "application/manifest+json" if path.endswith(".webmanifest") else None
                return FileResponse(f, headers=headers, media_type=media)
            return FileResponse(index, headers={"Cache-Control": "no-cache"})

    return app
