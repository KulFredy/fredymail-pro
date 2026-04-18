from __future__ import annotations

import email
import hashlib
import imaplib
import json
import logging
import os
import time
from datetime import datetime, timezone
from email.header import decode_header
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Optional

import httpx
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("mail_otonom")

# ---------------------------------------------------------------------------
# Config — all credentials from .env, never hardcoded
# ---------------------------------------------------------------------------

IMAP_HOST = os.environ["IMAP_HOST"]
IMAP_PORT = int(os.getenv("IMAP_PORT", "993"))
IMAP_USER = os.environ["IMAP_USER"]
IMAP_PASS = os.environ["IMAP_PASS"]

MEILI_URL = os.getenv("MEILI_URL", "http://127.0.0.1:7700")
MEILI_KEY = os.getenv("MEILI_KEY", "700m_2026_Mail")
MEILI_INDEX = os.getenv("MEILI_INDEX", "emails")

POLL_INTERVAL = int(os.getenv("POLL_INTERVAL_SECONDS", "180"))
FETCH_DAYS = int(os.getenv("FETCH_DAYS", "7"))

IMAP_FOLDERS = json.loads(
    os.getenv("IMAP_FOLDERS", '["INBOX", "Sent", "\\"Sent Messages\\""]')
)

MEILI_HEADERS = {
    "Authorization": f"Bearer {MEILI_KEY}",
    "Content-Type": "application/json",
}

STATE_FILE = Path(os.getenv("STATE_FILE", "fm_state.json"))


# ---------------------------------------------------------------------------
# State persistence (track last-seen UID per folder)
# ---------------------------------------------------------------------------

def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


# ---------------------------------------------------------------------------
# Header decoding
# ---------------------------------------------------------------------------

def decode_str(value: Optional[str]) -> str:
    if not value:
        return ""
    parts = decode_header(value)
    result = []
    for raw, charset in parts:
        if isinstance(raw, bytes):
            result.append(raw.decode(charset or "utf-8", errors="replace"))
        else:
            result.append(raw)
    return " ".join(result)


def extract_body(msg: email.message.Message) -> str:
    body = ""
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            cd = str(part.get("Content-Disposition", ""))
            if ct == "text/plain" and "attachment" not in cd:
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or "utf-8"
                    body += payload.decode(charset, errors="replace")
                    break
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            charset = msg.get_content_charset() or "utf-8"
            body = payload.decode(charset, errors="replace")
    return body.strip()


def make_id(folder: str, uid: str) -> str:
    return hashlib.md5(f"{folder}:{uid}".encode()).hexdigest()


def parse_timestamp(date_str: str) -> int:
    try:
        dt = parsedate_to_datetime(date_str)
        return int(dt.astimezone(timezone.utc).timestamp())
    except Exception:
        return int(time.time())


# ---------------------------------------------------------------------------
# Meilisearch indexing
# ---------------------------------------------------------------------------

def index_documents(docs: list[dict]) -> None:
    if not docs:
        return
    url = f"{MEILI_URL}/indexes/{MEILI_INDEX}/documents"
    with httpx.Client(timeout=30) as client:
        r = client.put(url, json=docs, headers=MEILI_HEADERS)
        r.raise_for_status()
    log.info("Indexed %d documents", len(docs))


# ---------------------------------------------------------------------------
# IMAP fetch for one folder
# ---------------------------------------------------------------------------

def fetch_folder(
    mail: imaplib.IMAP4_SSL,
    folder: str,
    since_date: str,
    state: dict,
) -> list[dict]:
    try:
        status, _ = mail.select(folder, readonly=True)
    except Exception as exc:
        log.warning("Cannot select folder %r: %s", folder, exc)
        return []

    if status != "OK":
        log.warning("SELECT %r returned %s", folder, status)
        return []

    try:
        status, data = mail.search(None, f'(SINCE "{since_date}")')
    except Exception as exc:
        log.warning("SEARCH in %r failed: %s", folder, exc)
        return []

    if status != "OK" or not data or not data[0]:
        return []

    uid_list = data[0].split()
    last_uid = state.get(folder, "0")
    new_uids = [u for u in uid_list if u.decode() > last_uid]

    if not new_uids:
        log.info("Folder %r: no new messages", folder)
        return []

    log.info("Folder %r: fetching %d new messages", folder, len(new_uids))
    docs: list[dict] = []

    for uid_bytes in new_uids:
        uid = uid_bytes.decode()
        try:
            status, raw = mail.fetch(uid_bytes, "(RFC822 RFC822.SIZE)")
            if status != "OK" or not raw:
                continue

            raw_email = raw[0][1] if isinstance(raw[0], tuple) else None
            if not raw_email:
                continue

            size_bytes = 0
            for part in raw:
                if isinstance(part, tuple) and b"RFC822.SIZE" in part[0]:
                    try:
                        size_bytes = int(part[0].split(b"RFC822.SIZE")[1].strip().split(b")")[0])
                    except Exception:
                        pass

            msg = email.message_from_bytes(raw_email)
            subject = decode_str(msg.get("Subject", ""))
            sender = decode_str(msg.get("From", ""))
            date_str = msg.get("Date", "")
            timestamp = parse_timestamp(date_str)

            docs.append({
                "id": make_id(folder, uid),
                "subject": subject,
                "sender": sender,
                "date": date_str,
                "timestamp": timestamp,
                "size": round(size_bytes / 1024, 1),
                "folder": folder,
                "body": extract_body(msg)[:8000],
            })
        except Exception as exc:
            log.warning("Error processing UID %s in %r: %s", uid, folder, exc)
            continue

    if new_uids:
        state[folder] = new_uids[-1].decode()

    return docs


# ---------------------------------------------------------------------------
# Main poll loop
# ---------------------------------------------------------------------------

def connect_imap() -> imaplib.IMAP4_SSL:
    mail = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT)
    mail.login(IMAP_USER, IMAP_PASS)
    return mail


def poll_once(state: dict) -> None:
    since_date = (
        datetime.now().replace(hour=0, minute=0, second=0)
        - __import__("datetime").timedelta(days=FETCH_DAYS)
    ).strftime("%d-%b-%Y")

    try:
        mail = connect_imap()
    except Exception as exc:
        log.error("IMAP connection failed: %s", exc)
        return

    try:
        all_docs: list[dict] = []
        for folder in IMAP_FOLDERS:
            try:
                docs = fetch_folder(mail, folder, since_date, state)
                all_docs.extend(docs)
            except Exception as exc:
                log.error("Error fetching folder %r: %s", folder, exc)
                continue
        if all_docs:
            index_documents(all_docs)
    finally:
        try:
            mail.logout()
        except Exception:
            pass

    save_state(state)


def main() -> None:
    log.info("mail_otonom starting — polling every %ds", POLL_INTERVAL)
    state = load_state()
    while True:
        try:
            poll_once(state)
        except Exception as exc:
            log.error("Unexpected error in poll_once: %s", exc)
        log.info("Sleeping %ds until next poll", POLL_INTERVAL)
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
