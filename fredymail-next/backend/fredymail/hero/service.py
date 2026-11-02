"""Hero planı: Yoldaki Mallar'ın günlük kopyası, "ilk kez görünen" tespiti ve aylık plan önerisi.

AI kullanmaz. Kampanyaların maillerden çıkarılması ayrı bir adımdır ve yalnızca kullanıcı isteğiyle çalışır.
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, date, datetime, timedelta, timezone, tzinfo
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from ..config import Settings
from ..mail.classify import fold
from ..models import HeroItem, KeyValue
from .sheet import MAX_PRODUCTS, HeroSheet, archive_title, period_text
from .yoldaki import YoldakiItem, month_bounds, parse_workbook

log = logging.getLogger("fredymail.hero")

CAMPAIGN_MIN_DAYS = 3  # ay içinde en az bu kadar gün sürmeyen kampanya devretmez


def local_tz(name: str) -> tzinfo:
    """İmajda saat dilimi verisi (tzdata) yoksa İstanbul için sabit UTC+3 (2016'dan beri yaz saati yok)."""
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        if name == "Europe/Istanbul":
            return timezone(timedelta(hours=3), "TRT")
        log.warning("saat dilimi bulunamadı (%s), UTC kullanılıyor", name)
        return UTC


def hero_configured(settings: Settings) -> bool:
    return bool(settings.hero_yoldaki_file_id and Path(settings.google_sa_file).is_file())


# ---------------------------------------------------------------- günlük kopya

def is_first_run(db: Session) -> bool:
    return db.execute(select(func.count()).select_from(HeroItem)).scalar_one() == 0


def sync_items(db: Session, items: list[YoldakiItem], today: date, baseline_keys: set[str] | None = None) -> dict:
    """Ürünleri `hero_items`'a işler.

    İlk okumada (tablo boş) ürünler `baseline` olur ve yeni sayılmaz. `baseline_keys` verilirse (dosyanın eski
    bir sürümündeki ürünler) yalnızca onlar baseline olur; eski sürümden sonra eklenenler hemen "yeni" görünür.
    """
    first_run = is_first_run(db)
    existing = set(db.execute(select(HeroItem.key)).scalars())
    added = []
    for it in items:
        stmt = insert(HeroItem).values(
            key=it.key[:400], brand=it.brand[:120], name=it.name, code=(it.code or None) and it.code[:120],
            first_seen=today, last_seen=today, last_status=it.arrival.raw, new_flag=it.new_flag,
            baseline=first_run and (baseline_keys is None or it.key in baseline_keys),
        ).on_conflict_do_update(index_elements=[HeroItem.key], set_={
            "last_seen": today, "last_status": it.arrival.raw, "name": it.name,
            "new_flag": HeroItem.new_flag | it.new_flag,
        })
        db.execute(stmt)
        if it.key[:400] not in existing:
            added.append(it.key)
    db.commit()
    if first_run:
        n_new = 0 if baseline_keys is None else sum(1 for it in items if it.key not in baseline_keys)
        return {"items": len(items), "added": n_new, "baseline": True}
    return {"items": len(items), "added": len(added), "baseline": False}


def new_product_keys(db: Session) -> set[str]:
    """Yeni ürün sayılanlar: tabloda YENİ ÜRÜN notu olanlar.

    "Yoldaki listede ilk kez görünmek" tek başına yeni ürün demek DEĞİLDİR: liste döner, depoya giren ürün düşer,
    yeniden siparişte geri gelir (ör. yıllardır satılan bataryalar). Bu yüzden ilk görünme yalnızca bilgi olarak
    tutulur (`first_seen_keys`); asıl ikinci ölçüt "zoomithalat.com'da henüz yok" kontrolü olacaktır.
    """
    return set(db.execute(select(HeroItem.key).where(HeroItem.new_flag.is_(True))).scalars())


def first_seen_keys(db: Session, today: date, days: int) -> set[str]:
    """Kurulumdan sonra yoldaki listeye ilk kez giren (son `days` gün) ürünler — bilgi amaçlı."""
    since = today - timedelta(days=days)
    rows = db.execute(select(HeroItem.key).where((HeroItem.baseline.is_(False)) & (HeroItem.first_seen >= since)))
    return set(rows.scalars())


def _set_kv(db: Session, key: str, value: dict) -> None:
    kv = db.get(KeyValue, key)
    if kv is None:
        db.add(KeyValue(key=key, value=value))
    else:
        kv.value = value
    db.commit()


def run_sync(db: Session, settings: Settings, client=None, today: date | None = None) -> dict:
    """Yoldaki Mallar'ı Drive'dan indirip işler. Sonuç `kv.hero_sync`'e yazılır (Ayarlar'da gösterilebilir)."""
    from .google import GoogleClient

    today = today or datetime.now(local_tz(settings.hero_timezone)).date()
    client = client or GoogleClient.from_file(settings.google_sa_file)
    data, meta = client.download_xlsx(settings.hero_yoldaki_file_id)
    items = parse_workbook(data, today)
    baseline_keys, baseline_from = None, None
    if is_first_run(db):
        try:  # ilk kurulum: dosyanın ~hero_new_days önceki sürümü "eskiden beri var" kabul edilir
            cutoff = (today - timedelta(days=settings.hero_new_days)).isoformat() + "T23:59:59Z"
            rev = client.oldest_revision_since(settings.hero_yoldaki_file_id, cutoff)
            if rev:
                old = parse_workbook(client.download_revision(settings.hero_yoldaki_file_id, rev["id"]), today)
                baseline_keys, baseline_from = {it.key for it in old}, rev["modifiedTime"]
        except Exception as e:  # noqa: BLE001
            log.warning("hero: eski sürüm okunamadı, tüm ürünler temel kabul edilecek: %s", e)
    res = sync_items(db, items, today, baseline_keys)
    if baseline_from:
        res["baseline_from"] = baseline_from
    res.update({"date": today.isoformat(), "file": meta.get("name"), "modified": meta.get("modifiedTime")})
    _set_kv(db, "hero_sync", res)
    return res


def maybe_run_daily(db: Session, settings: Settings, send_message=None, now: datetime | None = None) -> None:
    """Worker her döngüde çağırır: günde bir kez senkron, ayda bir kez hatırlatma. Hata worker'ı durdurmaz."""
    if not hero_configured(settings):
        return
    tz = local_tz(settings.hero_timezone)
    now = now.astimezone(tz) if now else datetime.now(tz)
    today = now.date()
    kv = db.get(KeyValue, "hero_sync")
    last = (kv.value or {}).get("date") if kv else None
    last_try = (kv.value or {}).get("tried") if kv else None
    if now.hour >= settings.hero_sync_hour and last != today.isoformat() and last_try != now.strftime("%Y-%m-%dT%H"):
        try:
            res = run_sync(db, settings, today=today)
            log.info("hero: yoldaki mallar okundu kalem=%s yeni=%s", res["items"], res["added"])
        except Exception as e:  # noqa: BLE001
            db.rollback()
            log.warning("hero: yoldaki mallar okunamadı: %s", e)
            # saatte en fazla bir deneme
            _set_kv(db, "hero_sync", {**((kv.value or {}) if kv else {}), "tried": now.strftime("%Y-%m-%dT%H"),
                                      "error": str(e)[:300]})
    if settings.hero_reminder_day and today.day >= settings.hero_reminder_day and send_message:
        rk = db.get(KeyValue, "hero_reminder")
        month_key = today.strftime("%Y-%m")
        if not rk or (rk.value or {}).get("month") != month_key:
            nxt = (today.replace(day=1) + timedelta(days=32)).replace(day=1)
            send_message(f"Hero listesi zamanı: {nxt.strftime('%m.%Y')} taslağını hazırlayıp onaylayın "
                         f"(fredymail hero-preview --month {nxt.strftime('%Y-%m')}).")
            _set_kv(db, "hero_reminder", {"month": month_key, "at": now.isoformat()})


def save_plan(db: Session, plan: dict) -> None:
    _set_kv(db, "hero_plan", plan)


def load_plan(db: Session) -> dict | None:
    kv = db.get(KeyValue, "hero_plan")
    return kv.value if kv else None


# ---------------------------------------------------------------- plan önerisi

_CAMPAIGN = re.compile(r"(\d{1,2})\.(\d{1,2})\s*-\s*(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?")


def campaign_end(text: str, ref: date) -> date | None:
    """'OM System Kampanya (08.10-01.11)' -> 2026-11-01. Kampanya içermeyen metin için None."""
    if "kampanya" not in fold(text):
        return None
    m = _CAMPAIGN.search(text)
    if not m:
        return None
    d1, m1, d2, m2, y = (int(g) if g else None for g in m.groups())
    year = (y + 2000 if y < 100 else y) if y else ref.year
    if not y and m2 is not None and m1 is not None and m2 < m1:  # 20.12-10.01: yıl devri
        year += 1
    try:
        return date(year, m2, d2)
    except (TypeError, ValueError):
        return None


def _tokens(s: str) -> set[str]:
    return {t for t in re.split(r"[^a-z0-9]+", fold(s)) if len(t) >= 2}


def same_product(a: str, b: str) -> bool:
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return False
    small = min(len(ta), len(tb))
    return len(ta & tb) / small >= 0.6


def build_plan(hs: HeroSheet, items: list[YoldakiItem], new_keys: set[str], year: int, month: int,
               today: date) -> dict:
    """Geçen ayın listesi + ay içinde stoğa girecek yeni ürünler → önerilen plan (kullanıcı onaylar)."""
    first, last = month_bounds(year, month)
    dropped: list[dict] = []
    plan_brands: list[dict] = []
    by_brand: dict[str, dict] = {}
    for row in hs.rows:
        kept = []
        for p in row.products:
            end = campaign_end(p.text, first)
            if end is not None and end < first + timedelta(days=CAMPAIGN_MIN_DAYS):
                dropped.append({"brand": row.brand, "text": p.text, "reason": f"kampanya {end:%d.%m} bitti"})
                continue
            kept.append({"text": p.text, "link": p.link, "source": "devreden", "flags": []})
        entry = {"brand": row.brand, "products": kept}
        plan_brands.append(entry)
        by_brand[row.brand] = entry

    overflow: list[dict] = []
    new_brands: dict[str, dict] = {}
    for it in items:
        a = it.arrival
        if not (it.new_flag or it.key in new_keys):
            continue
        if not (a.overlaps(first, last) or a.overdue(today)):
            continue
        flags = ["new"] + [f for f, on in (("uncertain", a.uncertain), ("overdue", a.overdue(today))) if on]
        prod = {"text": it.name, "link": None, "source": "yeni", "flags": flags, "status": a.raw,
                "qty": it.qty}
        entry = by_brand.get(it.brand)
        if entry is None:
            entry = new_brands.setdefault(it.brand, {"brand": it.brand, "products": [], "new_brand": True})
        if any(same_product(p["text"], it.name) for p in entry["products"]):
            for p in entry["products"]:  # zaten listede: yalnızca bilgi ekle
                if same_product(p["text"], it.name):
                    p.setdefault("status", a.raw)
            continue
        if len(entry["products"]) >= MAX_PRODUCTS:
            overflow.append({"brand": it.brand, **prod})
            continue
        entry["products"].append(prod)
    plan_brands.extend(new_brands[b] for b in sorted(new_brands))
    return {
        "month": f"{year}-{month:02d}",
        "period": period_text(year, month),
        "archive_title": archive_title(hs.period),
        "previous_period": hs.period,
        "brands": plan_brands,
        "dropped": dropped,
        "overflow": overflow,
        "total": sum(len(b["products"]) for b in plan_brands),
    }
