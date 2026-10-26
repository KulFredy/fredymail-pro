from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..ai import service
from ..ai.provider import AIError
from ..config import Settings, get_settings
from ..models import Draft, KeyValue, Message, Thread
from ..search.meili import Meili
from ..search.query import SearchParams, search
from .deps import get_db, get_meili, require_user

router = APIRouter(prefix="/api/ai", dependencies=[Depends(require_user)])


class AIRequest(BaseModel):
    message_id: int | None = None
    thread_id: int | None = None
    query: str = Field(default="", max_length=500)
    filters: dict = Field(default_factory=dict)
    instruction: str = Field(default="", max_length=1000)
    quality: str = Field(default="auto", pattern="^(auto|fast|best)$")


def _thread_msgs(db: Session, tid: int) -> list[Message]:
    msgs = db.execute(select(Message).where(Message.thread_id == tid, Message.deleted_on_server.is_(False))
                      .order_by(func.coalesce(Message.date, Message.created_at))).scalars().all()
    return list(msgs)


@router.get("/status")
def ai_status(db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    return {
        "configured": settings.ai_enabled_by_config,
        "enabled": service.ai_enabled(db, settings),
        "provider": settings.ai_provider,
        "model": settings.ai_model,
        "model_heavy": settings.ai_model_heavy or None,
        "heavy_kinds": [k.strip() for k in settings.ai_heavy_kinds.split(",") if k.strip()],
        "endpoint_host": settings.ai_base_url.split("//")[-1].split("/")[0] if settings.ai_base_url else None,
        "usage_today": service.usage_today(db),
        "limits": {"daily_budget_usd": settings.ai_daily_budget_usd, "max_calls_per_day": settings.ai_max_calls_per_day,
                   "max_messages": settings.ai_max_messages, "max_total_chars": settings.ai_max_total_chars},
        "privacy": {"pii_redaction": settings.ai_redact_pii, "attachments_sent": False,
                    "quoted_history_trimmed": True, "background_calls": False},
    }


class Toggle(BaseModel):
    enabled: bool


@router.post("/toggle")
def ai_toggle(body: Toggle, db: Session = Depends(get_db)):
    kv = db.get(KeyValue, "ai_enabled") or KeyValue(key="ai_enabled", value={})
    kv.value = {"enabled": body.enabled}
    db.merge(kv)
    db.commit()
    return {"enabled": body.enabled}


@router.post("/{kind}")
def ai_run(kind: str, body: AIRequest, db: Session = Depends(get_db), meili: Meili = Depends(get_meili),
           settings: Settings = Depends(get_settings)):
    if kind not in service.KINDS:
        raise HTTPException(404, "Bilinmeyen AI işlemi")
    msgs: list[Message] = []
    if kind == "search_summary":
        f: dict = {}
        try:
            for k in ("view", "sender", "recipient", "doc_kind", "file_kind"):
                if body.filters.get(k):
                    f[k] = str(body.filters[k])[:200]
            for k in ("folder_id", "tag_id"):
                if body.filters.get(k) not in (None, ""):
                    f[k] = int(body.filters[k])
            if body.filters.get("has_attachment") not in (None, ""):
                f["has_attachment"] = str(body.filters["has_attachment"]).lower() in ("true", "1")
            for k in ("date_from", "date_to"):
                if body.filters.get(k):
                    f[k] = date.fromisoformat(str(body.filters[k]))
        except (TypeError, ValueError) as e:
            raise HTTPException(400, "Geçersiz filtre değeri") from e
        res = search(db, meili, SearchParams(q=body.query, per_page=settings.ai_max_messages, **f))
        ids = [i["id"] for i in res["items"]]
        by = {m.id: m for m in db.execute(select(Message).where(Message.id.in_(ids))).scalars()}
        msgs = [by[i] for i in ids if i in by]
    elif kind in ("thread_summary", "draft", "actions", "followup") and (body.thread_id or body.message_id):
        tid = body.thread_id
        if tid is not None and db.get(Thread, tid) is None:
            raise HTTPException(404, "Yazışma bulunamadı")
        if tid is None:
            m = db.get(Message, body.message_id)
            if m is None:
                raise HTTPException(404, "Mail bulunamadı")
            tid = m.thread_id
        msgs = _thread_msgs(db, tid) if tid else [db.get(Message, body.message_id)]
        if kind != "draft":
            msgs = msgs[-settings.ai_max_messages:]
        else:
            msgs = msgs[-6:][::-1]  # taslak: en son mail ilk sırada (M1), en fazla 6 mail
    elif body.message_id:
        m = db.get(Message, body.message_id)
        if m is None:
            raise HTTPException(404, "Mail bulunamadı")
        msgs = [m]
    if not msgs:
        raise HTTPException(400, "İşlem için mail seçilmedi")

    try:
        out = service.run(db, settings, kind, msgs, query=body.query, instruction=body.instruction,
                          quality=body.quality)
    except service.AIBlocked as e:
        raise HTTPException(409, str(e)) from e
    except AIError as e:
        raise HTTPException(502, f"{e}. Arama ve mail görüntüleme etkilenmez.") from e

    if kind == "draft":
        target = next((m for m in msgs if not m.is_from_me), msgs[0])
        # Alıcılar modelden değil, kod ile yazışmadan belirlenir
        reply_to = [a["email"] for a in (target.reply_to or [])] or [target.from_email]
        to = [e for e in reply_to if e and e not in settings.my_addresses]
        if not to:  # son mail benimse, karşı tarafa yaz
            to = [a["email"] for a in (target.to_addrs or []) if a["email"] not in settings.my_addresses]
        subj = target.subject or ""
        subject = subj if subj.lower().startswith(("re:", "ynt:")) else f"Re: {subj}"
        d = Draft(thread_id=target.thread_id, reply_to_message_id=target.id, to_addrs=to[:10], subject=subject,
                  body=out.get("body", ""), source="ai", ai_run_id=out.get("meta", {}).get("run_id"), reviewed=False)
        db.add(d)
        db.commit()
        out["draft_id"] = d.id
        out["to"] = d.to_addrs
        out["subject"] = d.subject
    return out
