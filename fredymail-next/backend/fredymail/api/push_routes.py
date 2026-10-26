"""Yeni mail bildirimleri (Web Push) için abonelik uç noktaları."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..models import PushSubscription
from ..notify.webpush import endpoint_allowed, send_all, unb64u, vapid_keys
from .deps import get_db, require_user

router = APIRouter(prefix="/api/push", dependencies=[Depends(require_user)])


class Keys(BaseModel):
    p256dh: str = Field(min_length=80, max_length=200)
    auth: str = Field(min_length=16, max_length=64)


class SubIn(BaseModel):
    endpoint: str = Field(min_length=20, max_length=1000)
    keys: Keys
    label: str = Field(default="", max_length=120)


class EndpointIn(BaseModel):
    endpoint: str = Field(min_length=20, max_length=1000)


@router.get("/config")
def push_config(db: Session = Depends(get_db)):
    _, pub = vapid_keys(db)
    n = db.execute(select(func.count()).select_from(PushSubscription)).scalar_one()
    return {"public_key": pub, "subscriptions": n}


@router.post("/subscribe")
def subscribe(body: SubIn, db: Session = Depends(get_db)):
    if not endpoint_allowed(body.endpoint):
        raise HTTPException(400, "Desteklenmeyen bildirim servisi")
    try:
        pub, auth = unb64u(body.keys.p256dh), unb64u(body.keys.auth)
    except ValueError as e:
        raise HTTPException(400, "Geçersiz anahtar") from e
    if len(pub) != 65 or pub[0] != 4 or len(auth) != 16:
        raise HTTPException(400, "Geçersiz anahtar")
    sub = db.execute(select(PushSubscription).where(PushSubscription.endpoint == body.endpoint)).scalar_one_or_none()
    if sub is None:
        sub = PushSubscription(endpoint=body.endpoint, failures=0)
        db.add(sub)
    sub.p256dh, sub.auth, sub.label = body.keys.p256dh, body.keys.auth, body.label
    db.commit()
    return {"ok": True}


@router.post("/unsubscribe")
def unsubscribe(body: EndpointIn, db: Session = Depends(get_db)):
    sub = db.execute(select(PushSubscription).where(PushSubscription.endpoint == body.endpoint)).scalar_one_or_none()
    if sub is not None:
        db.delete(sub)
        db.commit()
    return {"ok": True}


@router.post("/test")
def test_push(db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    ok, fail = send_all(db, settings, {"title": "FredyMail", "body": "Bildirimler bu cihazda çalışıyor.",
                                       "url": "/#/mail?view=inbox", "tag": "test"})
    return {"sent": ok, "failed": fail}
