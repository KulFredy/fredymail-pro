from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

MEILI_URL = os.getenv("MEILI_URL", "http://127.0.0.1:7700")
MEILI_KEY = os.getenv("MEILI_KEY", "700m_2026_Mail")
MEILI_INDEX = os.getenv("MEILI_INDEX", "emails")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

DATA_DIR = Path(os.getenv("DATA_DIR", "."))
TAGS_FILE = DATA_DIR / "fm_tags.json"
NOTES_FILE = DATA_DIR / "fm_notes.json"
SNOOZE_FILE = DATA_DIR / "fm_snooze.json"
READS_FILE = DATA_DIR / "fm_reads.json"

# ---------------------------------------------------------------------------
# Gemini SDK (new SDK preferred, legacy fallback)
# ---------------------------------------------------------------------------

_gemini_new: Any = None
_gemini_legacy: Any = None

try:
    from google import genai as _gn
    _gemini_client = _gn.Client(api_key=GEMINI_API_KEY)
    _gemini_new = _gemini_client
except Exception:
    pass

if _gemini_new is None:
    try:
        import google.generativeai as _gl
        _gl.configure(api_key=GEMINI_API_KEY)
        _gemini_legacy = _gl.GenerativeModel("gemini-2.5-flash")
    except Exception:
        pass


def gemini_generate(prompt: str) -> str:
    if _gemini_new:
        try:
            resp = _gemini_new.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
            )
            return resp.text or ""
        except Exception:
            pass
    if _gemini_legacy:
        try:
            resp = _gemini_legacy.generate_content(prompt)
            return resp.text or ""
        except Exception:
            pass
    raise RuntimeError("No working Gemini SDK found")


# ---------------------------------------------------------------------------
# Meilisearch helper
# ---------------------------------------------------------------------------

MEILI_HEADERS = {
    "Authorization": f"Bearer {MEILI_KEY}",
    "Content-Type": "application/json",
}


def meili_search(payload: dict) -> dict:
    url = f"{MEILI_URL}/indexes/{MEILI_INDEX}/search"
    with httpx.Client(timeout=10) as client:
        r = client.post(url, json=payload, headers=MEILI_HEADERS)
        r.raise_for_status()
        return r.json()


def meili_get_document(doc_id: str) -> dict:
    url = f"{MEILI_URL}/indexes/{MEILI_INDEX}/documents/{doc_id}"
    with httpx.Client(timeout=10) as client:
        r = client.get(url, headers=MEILI_HEADERS)
        r.raise_for_status()
        return r.json()


def meili_update_documents(docs: list[dict]) -> dict:
    url = f"{MEILI_URL}/indexes/{MEILI_INDEX}/documents"
    with httpx.Client(timeout=30) as client:
        r = client.put(url, json=docs, headers=MEILI_HEADERS)
        r.raise_for_status()
        return r.json()


def meili_get_facets(attribute: str) -> dict[str, int]:
    payload = {
        "q": "",
        "limit": 0,
        "facets": [attribute],
    }
    data = meili_search(payload)
    return data.get("facetDistribution", {}).get(attribute, {})


# ---------------------------------------------------------------------------
# JSON file store helpers
# ---------------------------------------------------------------------------

def _load(path: Path) -> dict:
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def _save(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="FredyMail Pro API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class SearchQuery(BaseModel):
    q: str = ""
    limit: int = 50
    offset: int = 0
    folder: Optional[str] = None
    year: Optional[int] = None
    sort: Optional[str] = None        # e.g. "timestamp:desc"
    filter_type: Optional[str] = None  # "AND" | "OR"
    ai_mode: bool = False


class MoveRequest(BaseModel):
    id: str
    target_folder: str


class AIActionRequest(BaseModel):
    action: str
    email_ids: list[str] = []
    context: str = ""


class TagRequest(BaseModel):
    id: str
    tag: str


class NoteRequest(BaseModel):
    id: str
    note: str


class SnoozeRequest(BaseModel):
    id: str
    until: int  # unix timestamp


class ReadRequest(BaseModel):
    ids: list[str]


# ---------------------------------------------------------------------------
# Search endpoint
# ---------------------------------------------------------------------------

@app.post("/search")
async def search(query: SearchQuery):
    filters: list[str] = []

    # Universal folder filter — works for ANY folder name
    if query.folder and query.folder not in ("", "all"):
        safe = query.folder.replace("'", "\\'")
        filters.append(f"folder = '{safe}'")

    # Year filter via timestamp range
    if query.year:
        start = int(datetime(query.year, 1, 1).timestamp())
        end = int(datetime(query.year + 1, 1, 1).timestamp())
        filters.append(f"timestamp >= {start} AND timestamp < {end}")

    filter_str = " AND ".join(f"({f})" for f in filters) if filters else None

    payload: dict[str, Any] = {
        "q": query.q,
        "limit": query.limit,
        "offset": query.offset,
        "attributesToHighlight": ["subject", "body"],
        "attributesToRetrieve": [
            "id", "subject", "sender", "date", "timestamp",
            "size", "folder", "body",
        ],
    }

    if filter_str:
        payload["filter"] = filter_str

    # OR mode: use matchingStrategy "any" instead of appending OR keywords
    if query.filter_type == "OR":
        payload["matchingStrategy"] = "any"

    if query.sort:
        payload["sort"] = [query.sort]

    if query.ai_mode:
        payload["limit"] = max(payload["limit"], 100)

    data = meili_search(payload)
    return data


# ---------------------------------------------------------------------------
# Move endpoint
# ---------------------------------------------------------------------------

@app.post("/move")
async def move_email(req: MoveRequest):
    try:
        doc = meili_get_document(req.id)
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=404, detail=f"Email {req.id} not found") from e

    doc["folder"] = req.target_folder
    result = meili_update_documents([doc])
    return {"status": "ok", "task": result}


# ---------------------------------------------------------------------------
# Folders endpoint (facet-based, no hardcoding)
# ---------------------------------------------------------------------------

@app.get("/folders")
async def get_folders():
    distribution = meili_get_facets("folder")
    folders = [
        {"name": name, "count": count}
        for name, count in sorted(distribution.items(), key=lambda x: -x[1])
    ]
    return {"folders": folders}


# ---------------------------------------------------------------------------
# Reindex endpoint — triggers Meilisearch settings refresh
# ---------------------------------------------------------------------------

@app.post("/reindex")
async def reindex():
    settings = {
        "filterableAttributes": ["sender", "date", "timestamp", "size", "folder"],
        "sortableAttributes": ["timestamp", "size", "sender"],
        "faceting": {"maxValuesPerFacet": 500},
        "pagination": {"maxTotalHits": 50000},
    }
    url = f"{MEILI_URL}/indexes/{MEILI_INDEX}/settings"
    with httpx.Client(timeout=30) as client:
        r = client.patch(url, json=settings, headers=MEILI_HEADERS)
        r.raise_for_status()
        return {"status": "ok", "task": r.json()}


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    try:
        with httpx.Client(timeout=3) as client:
            r = client.get(f"{MEILI_URL}/health", headers=MEILI_HEADERS)
            meili_ok = r.status_code == 200
    except Exception:
        meili_ok = False

    stats: dict[str, Any] = {"meili": meili_ok, "gemini": bool(GEMINI_API_KEY)}
    if meili_ok:
        try:
            with httpx.Client(timeout=5) as client:
                r = client.get(
                    f"{MEILI_URL}/indexes/{MEILI_INDEX}/stats",
                    headers=MEILI_HEADERS,
                )
                stats["email_count"] = r.json().get("numberOfDocuments", 0)
        except Exception:
            pass
    return stats


# ---------------------------------------------------------------------------
# Tags
# ---------------------------------------------------------------------------

@app.get("/tags/{email_id}")
async def get_tags(email_id: str):
    data = _load(TAGS_FILE)
    return {"tags": data.get(email_id, [])}


@app.post("/tags")
async def add_tag(req: TagRequest):
    data = _load(TAGS_FILE)
    tags: list[str] = data.get(req.id, [])
    if req.tag not in tags:
        tags.append(req.tag)
    data[req.id] = tags
    _save(TAGS_FILE, data)
    return {"tags": tags}


@app.delete("/tags")
async def remove_tag(req: TagRequest):
    data = _load(TAGS_FILE)
    tags: list[str] = data.get(req.id, [])
    tags = [t for t in tags if t != req.tag]
    data[req.id] = tags
    _save(TAGS_FILE, data)
    return {"tags": tags}


# ---------------------------------------------------------------------------
# Notes
# ---------------------------------------------------------------------------

@app.get("/notes/{email_id}")
async def get_note(email_id: str):
    data = _load(NOTES_FILE)
    return {"note": data.get(email_id, "")}


@app.post("/notes")
async def save_note(req: NoteRequest):
    data = _load(NOTES_FILE)
    data[req.id] = req.note
    _save(NOTES_FILE, data)
    return {"note": req.note}


@app.delete("/notes/{email_id}")
async def delete_note(email_id: str):
    data = _load(NOTES_FILE)
    data.pop(email_id, None)
    _save(NOTES_FILE, data)
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Snooze
# ---------------------------------------------------------------------------

@app.get("/snooze/due")
async def get_due_snoozes():
    data = _load(SNOOZE_FILE)
    now = int(time.time())
    due = [{"id": k, "until": v} for k, v in data.items() if v <= now]
    return {"due": due}


@app.get("/snooze/{email_id}")
async def get_snooze(email_id: str):
    data = _load(SNOOZE_FILE)
    return {"until": data.get(email_id)}


@app.post("/snooze")
async def set_snooze(req: SnoozeRequest):
    data = _load(SNOOZE_FILE)
    data[req.id] = req.until
    _save(SNOOZE_FILE, data)
    return {"until": req.until}


@app.delete("/snooze/{email_id}")
async def clear_snooze(email_id: str):
    data = _load(SNOOZE_FILE)
    data.pop(email_id, None)
    _save(SNOOZE_FILE, data)
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Read status
# ---------------------------------------------------------------------------

@app.get("/reads")
async def get_reads():
    data = _load(READS_FILE)
    return {"reads": list(data.keys())}


@app.post("/reads")
async def mark_reads(req: ReadRequest):
    data = _load(READS_FILE)
    now = int(time.time())
    for id_ in req.ids:
        data[id_] = now
    _save(READS_FILE, data)
    return {"marked": len(req.ids)}


# ---------------------------------------------------------------------------
# Awaiting reply — batch approach to avoid N+1
# ---------------------------------------------------------------------------

@app.get("/awaiting_reply")
async def awaiting_reply():
    # Fetch last 200 sent emails in one query
    sent_data = meili_search({
        "q": "",
        "limit": 200,
        "filter": "folder = 'Sent' OR folder = 'Sent Messages'",
        "sort": ["timestamp:desc"],
        "attributesToRetrieve": ["id", "subject", "sender", "timestamp", "body"],
    })
    sent_hits = sent_data.get("hits", [])

    # Normalize subjects for threading
    def normalize_subject(s: str) -> str:
        return re.sub(r"^(re|fwd?|aw|fw)[\s:]+", "", s.strip(), flags=re.IGNORECASE).strip().lower()

    # Collect all normalized subjects in one set, then do a SINGLE broad search
    normalized = {normalize_subject(h.get("subject", "")): h for h in sent_hits}

    if not normalized:
        return {"awaiting": []}

    # Use first 20 subjects as OR query to find reply threads efficiently
    sample_subjects = list(normalized.keys())[:20]
    query_str = " ".join(sample_subjects[:5])  # Meilisearch OR via matchingStrategy

    inbox_data = meili_search({
        "q": query_str,
        "limit": 500,
        "filter": "folder = 'INBOX'",
        "matchingStrategy": "any",
        "attributesToRetrieve": ["id", "subject", "timestamp"],
    })
    inbox_hits = inbox_data.get("hits", [])

    # Build set of normalized inbox subjects received AFTER sent timestamp
    inbox_threads: dict[str, int] = {}
    for hit in inbox_hits:
        ns = normalize_subject(hit.get("subject", ""))
        ts = hit.get("timestamp", 0)
        if ns not in inbox_threads or ts > inbox_threads[ns]:
            inbox_threads[ns] = ts

    # Filter: sent emails where no inbox reply arrived after send time
    awaiting = []
    cutoff = int((datetime.now() - timedelta(days=30)).timestamp())
    for norm_subj, sent_hit in normalized.items():
        sent_ts = sent_hit.get("timestamp", 0)
        if sent_ts < cutoff:
            continue
        reply_ts = inbox_threads.get(norm_subj, 0)
        if reply_ts <= sent_ts:
            awaiting.append(sent_hit)

    awaiting.sort(key=lambda h: h.get("timestamp", 0), reverse=True)
    return {"awaiting": awaiting[:50]}


# ---------------------------------------------------------------------------
# AI action
# ---------------------------------------------------------------------------

_AI_SYSTEM = """Sen FredyMail Pro'nun yapay zeka asistanısın.
Kullanıcıya e-posta yönetimi konusunda Türkçe yardım ediyorsun.
E-postaları analiz et, özetle, eylem öner ve soruları yanıtla.
Yanıtların kısa, net ve eyleme dönük olsun."""


@app.post("/ai_action")
async def ai_action(req: AIActionRequest):
    email_contexts: list[str] = []

    if req.email_ids:
        for eid in req.email_ids[:20]:
            try:
                doc = meili_get_document(eid)
                body_preview = (doc.get("body") or "")[:1200]
                email_contexts.append(
                    f"--- E-posta ---\n"
                    f"Kimden: {doc.get('sender', '')}\n"
                    f"Konu: {doc.get('subject', '')}\n"
                    f"Tarih: {doc.get('date', '')}\n"
                    f"İçerik:\n{body_preview}"
                )
            except Exception:
                continue

    if not email_contexts and req.context:
        email_contexts = [req.context]

    emails_block = "\n\n".join(email_contexts) if email_contexts else "(E-posta içeriği yok)"

    prompt = (
        f"{_AI_SYSTEM}\n\n"
        f"Eylem: {req.action}\n\n"
        f"E-postalar:\n{emails_block}\n\n"
        f"Yanıt:"
    )

    try:
        result = gemini_generate(prompt)
        return {"result": result}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"AI hatası: {e}") from e


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
