"""'Sor' asistanı: doğal dildeki Türkçe soruyu güvenli bir sorgu PLANINA çevirir ve çalıştırır.

Güvenlik: Plan, sabit bir şemaya (mod, istatistik türü, dönem, filtreler) indirgenir; yalnızca önceden
tanımlı sorgular çalışır. AI kullanılırsa yalnızca kullanıcının sorusunu görür (mail içeriği değil) ve
çıktısı aynı şemayla doğrulanır; SQL veya serbest komut üretemez.

Önce kurallı ayrıştırıcı denenir ("bu ay", "geçen yıl", "en çok kimden", "Roy Bey'den gelen faturalar"...).
Soru tanınmazsa ve AI açıksa AI planlayıcı kullanılır; AI kapalıysa soru anahtar kelime aramasına dönüşür.
"""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from ..mail.classify import DOC_KIND_LABELS, FILE_KIND_LABELS, fold
from ..models import Message
from .insights import period_range, top_domains, top_recipients, top_senders, volume
from .query import SearchParams, _view_filters_pg, followups, resolve_people, search

MODES = ("search", "stats", "followups")
STATS = ("top_senders", "top_recipients", "top_domains", "count", "volume")


@dataclass
class Plan:
    mode: str = "search"
    stat: str | None = None
    followup_kind: str | None = None
    period: dict = field(default_factory=lambda: {"kind": "all"})
    direction: str = "any"  # in | out | any
    person: str = ""
    doc_kind: str = ""
    file_kind: str = ""
    has_attachment: bool | None = None
    unread: bool | None = None
    important: bool | None = None
    keywords: str = ""
    understood: list[str] = field(default_factory=list)
    recognized: bool = False


MONTHS = ["ocak", "subat", "mart", "nisan", "mayis", "haziran", "temmuz", "agustos", "eylul", "ekim", "kasim",
          "aralik"]

_DOC_WORDS = [
    (r"fiyat\s*liste\w*|price\s*list\w*|pricelist\w*", "pricelist"),
    (r"proforma\w*", "proforma"),
    (r"e-?fatura\w*|fatura\w*|invoice\w*", "invoice"),
    (r"teklif\w*|quotation\w*", "quote"),
    (r"siparis\w*", "order"),
    (r"ekstre\w*|mutabakat\w*|cari\s*hesap\w*", "statement"),
    (r"sozlesme\w*|contract\w*", "contract"),
    (r"irsaliye\w*|sevkiyat\w*|kargo\w*", "shipping"),
]
_FILE_WORDS = [
    (r"\bpdf\w*", "pdf"),
    (r"\bexcel\w*|\bxlsx?\b|\btablo\w*", "spreadsheet"),
    (r"\bword\b|\bdocx?\b", "document"),
    (r"\bgorsel\w*|\bresim\w*|\bfotograf\w*|\bfoto\b|\bjpe?g\b|\bpng\b", "image"),
    (r"\bzip\b|\brar\b", "archive"),
]
_STOP = set("""bana beni benim icin goster getir bul listele ara arat mail mailler mailleri maili mailim maillerim
e-posta eposta e-postalar posta olan olanlar ile ilgili hakkinda tum butun ve veya ya de da mi mu ne kac en cok
fazla kimden kime gelen giden gonderdigim gonderdiklerim gonderilen aldigim aldiklarim aldim bu gecen ay ayki yil
sene hafta gun bugun dun son tane adet toplam hangi hangileri var mi miydi midir sayisi nedir nelerdir icinde
eki ekli ek iceren okunmamis okumadigim onemli lutfen bi bir sey seyler""".split())


def _push(plan: Plan, label: str) -> None:
    plan.understood.append(label)
    plan.recognized = True


def parse_rules(question: str, now: datetime | None = None) -> Plan:
    now = now or datetime.now(UTC)
    raw = question.strip()
    t = " " + fold(raw) + " "
    plan = Plan()
    consumed: list[str] = []

    def take(rx: str) -> re.Match | None:
        nonlocal t
        m = re.search(rx, t)
        if m:
            consumed.append(m.group(0))
            t = t[:m.start()] + " " + t[m.end():]
        return m

    # --- dönem
    if take(r"\bbugun(ku|kü)?\b"):
        plan.period = {"kind": "today"}
    elif take(r"\bdun(ku)?\b"):
        plan.period = {"kind": "yesterday"}
    elif take(r"\bbu hafta\w*"):
        plan.period = {"kind": "this_week"}
    elif take(r"\bgecen hafta\w*"):
        plan.period = {"kind": "last_week"}
    elif take(r"\bbu ay\w*"):
        plan.period = {"kind": "this_month"}
    elif take(r"\bgecen ay\w*"):
        plan.period = {"kind": "last_month"}
    elif take(r"\b(bu yil|bu sene)\w*"):
        plan.period = {"kind": "this_year"}
    elif take(r"\b(gecen yil|gecen sene)\w*"):
        plan.period = {"kind": "last_year"}
    elif m := take(r"\bson (\d{1,3}) (gun|hafta|ay|yil)\w*"):
        n, unit = int(m.group(1)), m.group(2)
        plan.period = {"kind": "last_n_days", "n": n * {"gun": 1, "hafta": 7, "ay": 30, "yil": 365}[unit]}
    else:
        mm = re.search(r"\b(" + "|".join(MONTHS) + r")\w*(?:\s+((?:19|20)\d{2}))?", t)
        if mm:
            consumed.append(mm.group(0))
            t = t[:mm.start()] + " " + t[mm.end():]
            plan.period = {"kind": "month", "month": MONTHS.index(mm.group(1)) + 1,
                           "year": int(mm.group(2)) if mm.group(2) else None}
        elif y := take(r"\b((?:19|20)\d{2})\w*"):
            plan.period = {"kind": "year", "year": int(y.group(1))}
    if plan.period["kind"] != "all":
        r = period_range(**_period_args(plan.period, now))
        _push(plan, r.label)

    # --- takip görünümleri
    if take(r"(cevaplanmamis|cevaplanmayan|cevap vermedigim|yanitlamadigim|yanitlamam gereken\w*|"
            r"donus yapmadigim|cevap bekleyen)"):
        plan.mode, plan.followup_kind = "followups", "needs_reply"
        _push(plan, "Yanıtlamam gerekenler")
    elif take(r"(yanit bekledigim|yanit bekliyorum|cevap bekledigim|donmeyen\w*|yanit gelmeyen|"
              r"cevap gelmeyen|yanit vermeyen|cevap vermeyen)"):
        plan.mode, plan.followup_kind = "followups", "awaiting"
        _push(plan, "Yanıt beklediklerim")

    # --- istatistik niyeti
    if plan.mode != "followups":
        if take(r"\b(en (cok|fazla) kime|kime en (cok|fazla))\w*"):
            plan.mode, plan.stat, plan.direction = "stats", "top_recipients", "out"
            _push(plan, "En çok yazdığım kişiler")
        elif take(r"\b(en (cok|fazla) kimden|kimden en (cok|fazla)|en (cok|fazla) (mail|e-?posta) (atan|gonderen|yazan)|"
                  r"en aktif (kisi|gonderen)\w*)"):
            plan.mode, plan.stat, plan.direction = "stats", "top_senders", "in"
            _push(plan, "En çok yazan kişiler")
        elif take(r"\b(hangi (firma|sirket|kurum)\w*|firma bazinda|sirket bazinda|domain\w*)"):
            plan.mode, plan.stat, plan.direction = "stats", "top_domains", "in"
            _push(plan, "Firmalara göre")
        elif take(r"\b(aylara gore|gunlere gore|dagilim\w*|grafik\w*|trend\w*|yogunluk\w*)"):
            plan.mode, plan.stat = "stats", "volume"
            _push(plan, "Zamana göre dağılım")
        elif take(r"\b(kac (tane |adet )?(mail|e-?posta|ileti)\w*|toplam kac|kac tane)"):
            plan.mode, plan.stat = "stats", "count"
            _push(plan, "Sayım")

    # --- yön
    if take(r"\b(gonderdigim\w*|gonderilen\w*|giden\w*|yolladigim\w*|attigim\w*)"):
        plan.direction = "out"
        _push(plan, "Gönderdiklerim")
    elif re.search(r"\b(gelen|aldigim\w*|aldim)\b", t) and plan.direction == "any":
        plan.direction = "in"
        _push(plan, "Gelen mailler")

    # --- belge / dosya türü
    for rx, kind in _DOC_WORDS:
        if take(r"\b(" + rx + r")"):
            plan.doc_kind = kind
            _push(plan, DOC_KIND_LABELS[kind])
            break
    for rx, kind in _FILE_WORDS:
        if take(rx):
            plan.file_kind = kind
            _push(plan, FILE_KIND_LABELS[kind] + " ekli")
            break
    if take(r"\b(ekli|eki olan|ek iceren|ekleri olan)\b"):
        plan.has_attachment = True
        _push(plan, "Ekli")
    if take(r"\b(okunmamis|okumadigim)\w*"):
        plan.unread = True
        _push(plan, "Okunmamış")
    if take(r"\bonemli\w*"):
        plan.important = True
        _push(plan, "Önemli")

    # --- kişi: "Roy Bey'den", "Klodin'e", "Acme ile"
    pm = re.search(r"([A-Za-zÇĞİÖŞÜçğıöşü0-9.&@-]+(?:\s+[A-Za-zÇĞİÖŞÜçğıöşü0-9.&-]+){0,2})\s*['’]\s*"
                   r"(?:dan|den|tan|ten|a|e|ya|ye|ndan|nden|nin|nın|nun|nün|in|ın|un|ün)\b", raw)
    pm2 = re.search(r"([A-Za-zÇĞİÖŞÜçğıöşü0-9.&@-]+(?:\s+[A-Za-zÇĞİÖŞÜçğıöşü0-9.&-]+){0,2})\s+ile\b", raw)
    for m in (pm, pm2):
        if m:
            cand = m.group(1).strip()
            words = [w for w in cand.split() if fold(w) not in _STOP and not w.isdigit()
                     and not any(fold(w).startswith(mo) for mo in MONTHS)]
            if words:
                plan.person = " ".join(words)
                t = t.replace(fold(m.group(0)), " ")
                break
    if not plan.person and (em := re.search(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+", raw)):
        plan.person = em.group(0).lower()
        t = t.replace(fold(em.group(0)), " ")

    # --- kalan kelimeler = arama terimleri
    rest = [w for w in re.findall(r"[a-z0-9@._-]+", t) if w not in _STOP and len(w) > 1
            and not any(fold(p.split()[0]) in w for p in [plan.person] if p)]
    plan.keywords = " ".join(rest)[:200]
    if plan.mode == "search" and not plan.keywords and not plan.recognized and not plan.person:
        plan.keywords = raw[:200]
    return plan


def _period_args(period: dict, now: datetime) -> dict:
    a = {"kind": period.get("kind", "all"), "now": now}
    for k in ("n", "year", "month"):
        if period.get(k):
            a[k] = int(period[k])
    return a


# ------------------------------------------------------------------ AI planlayıcı

AI_PLAN_PROMPT = """Kullanıcının e-posta kutusu hakkındaki Türkçe sorusunu bir sorgu planına çevir. YALNIZCA JSON döndür.
Şema:
{"mode": "search|stats|followups",
 "stat": "top_senders|top_recipients|top_domains|count|volume|null",
 "followup_kind": "needs_reply|awaiting|null",
 "period": {"kind": "all|today|yesterday|this_week|last_week|this_month|last_month|this_year|last_year|last_n_days|year|month",
            "n": gün sayısı|null, "year": yıl|null, "month": 1-12|null},
 "direction": "in|out|any", "person": "kişi/firma adı veya e-posta ya da boş",
 "doc_kind": "invoice|proforma|pricelist|quote|order|statement|contract|shipping|boş",
 "file_kind": "pdf|spreadsheet|document|image|archive|boş",
 "has_attachment": true|false|null, "unread": true|null, "important": true|null,
 "keywords": "aranacak anahtar kelimeler (Türkçe/İngilizce) ya da boş"}
Bugünün tarihi: {today}."""


def parse_ai(question: str, db: Session, settings, now: datetime) -> Plan | None:
    from ..ai import service
    from ..ai.provider import AIError, get_provider
    from ..models import AiRun

    if not service.ai_enabled(db, settings):
        return None
    provider = get_provider(settings)
    if provider is None or provider.name == "fake":
        return None
    try:
        service._check_budget(db, settings)
    except service.AIBlocked:
        return None
    run = AiRun(kind="ask", cache_key="", provider=provider.name, model=provider.model, message_ids=[],
                chars_sent=len(question), status="error")
    try:
        res = provider.complete(AI_PLAN_PROMPT.replace("{today}", now.date().isoformat()), question[:500], 400)
        raw = service._parse_json(res.text)
        run.status, run.prompt_tokens, run.completion_tokens = "ok", res.prompt_tokens, res.completion_tokens
        run.cost_usd = service._cost(settings, res.prompt_tokens, res.completion_tokens)
    except (AIError, ValueError):
        return None
    finally:
        db.add(run)
        db.commit()
    p = Plan(recognized=True)
    p.mode = raw.get("mode") if raw.get("mode") in MODES else "search"
    p.stat = raw.get("stat") if raw.get("stat") in STATS else None
    if p.mode == "stats" and not p.stat:
        p.mode = "search"
    p.followup_kind = raw.get("followup_kind") if raw.get("followup_kind") in ("needs_reply", "awaiting") else None
    if p.mode == "followups" and not p.followup_kind:
        p.followup_kind = "needs_reply"
    per = raw.get("period") or {}
    p.period = {k: per.get(k) for k in ("kind", "n", "year", "month") if per.get(k) not in (None, "")}
    p.period.setdefault("kind", "all")
    p.direction = raw.get("direction") if raw.get("direction") in ("in", "out") else "any"
    p.person = str(raw.get("person") or "")[:80]
    p.doc_kind = raw.get("doc_kind") if raw.get("doc_kind") in DOC_KIND_LABELS else ""
    p.file_kind = raw.get("file_kind") if raw.get("file_kind") in FILE_KIND_LABELS else ""
    p.has_attachment = raw.get("has_attachment") if isinstance(raw.get("has_attachment"), bool) else None
    p.unread = True if raw.get("unread") is True else None
    p.important = True if raw.get("important") is True else None
    p.keywords = str(raw.get("keywords") or "")[:200]
    return p


# ------------------------------------------------------------------ çalıştırma


def plan_params(plan: Plan, db: Session, now: datetime) -> tuple[SearchParams, object]:
    try:
        r = period_range(**_period_args(plan.period, now))
    except (TypeError, ValueError):
        r = period_range("all")
    p = SearchParams(q=plan.keywords, doc_kind=plan.doc_kind, file_kind=plan.file_kind,
                     has_attachment=plan.has_attachment, unread=plan.unread, important=plan.important,
                     sort="" if plan.keywords else "date_desc", per_page=50)
    if plan.person:
        if plan.direction == "in":
            p.sender = plan.person
        elif plan.direction == "out":
            p.recipient = plan.person
        else:
            p.participant = plan.person
    if plan.direction == "out":
        p.view = "sent"
    if r.start:
        p.date_from = r.start.date()
    if r.end:
        from datetime import timedelta

        p.date_to = (r.end - timedelta(days=1)).date()
    return p, r


def run_question(db: Session, meili, settings, question: str, now: datetime | None = None,
                 allow_ai: bool = True) -> dict:
    now = now or datetime.now(UTC)
    plan, engine = parse_rules(question, now), "rules"
    if allow_ai and not plan.recognized and not plan.person:
        ai_plan = parse_ai(question, db, settings, now)
        if ai_plan is not None:
            plan, engine = ai_plan, "ai"
    params, rng = plan_params(plan, db, now)
    understood = list(plan.understood)
    if plan.person:
        found = resolve_people(db, plan.person, "from") or []
        if found == ["__yok__"] and (resolve_people(db, plan.person, "to") or []) == ["__yok__"]:
            understood.append(f"“{plan.person}” adlı kişi bulunamadı")
        else:
            understood.append(f"Kişi/firma: {plan.person}")
    if plan.keywords:
        understood.append(f"Arama: “{plan.keywords}”")

    out: dict = {"question": question, "engine": engine, "mode": plan.mode, "understood": understood,
                 "plan": asdict(plan), "params": _params_dict(params), "period_label": rng.label}
    if plan.mode == "followups":
        days = settings.needs_reply_days if plan.followup_kind == "needs_reply" else settings.awaiting_reply_days
        out["followup_kind"] = plan.followup_kind
        out["followups"] = followups(db, plan.followup_kind, days, settings.my_addresses)
        return out
    if plan.mode == "stats":
        out["stat"] = plan.stat
        params_no_q = params
        if plan.stat in ("top_senders", "top_domains") and params.view == "sent":
            params_no_q.view = "all"
        if plan.stat == "top_senders":
            rows = top_senders(db, rng, params_no_q, limit=10)
            out["stats"] = {"title": "En çok mail gönderenler", "note": "Otomatik bültenler hariç",
                            "rows": [{"label": x["name"], "sublabel": x["email"], "count": x["count"],
                                      "filter": x["filter"]} for x in rows]}
        elif plan.stat == "top_domains":
            rows = top_domains(db, rng, params_no_q, limit=10)
            out["stats"] = {"title": "En çok yazışılan firmalar", "note": "Gelen mailler, bültenler hariç",
                            "rows": [{"label": x["domain"], "sublabel": "", "count": x["count"],
                                      "filter": x["filter"]} for x in rows]}
        elif plan.stat == "top_recipients":
            rows = top_recipients(db, rng, params, limit=10, my_addresses=settings.my_addresses)
            out["stats"] = {"title": "En çok mail gönderdiğim kişiler", "note": "",
                            "rows": [{"label": x["name"], "sublabel": x["email"], "count": x["count"],
                                      "filter": x["filter"]} for x in rows]}
        elif plan.stat == "volume":
            out["stats"] = {"title": "Zamana göre mail hacmi", "note": "", "volume": volume(db, rng, params)}
        else:
            where = and_(*_view_filters_pg(params, db))
            inn, outc = db.execute(select(func.count().filter(Message.is_from_me.is_(False)),
                                          func.count().filter(Message.is_from_me.is_(True))).where(where)).one()
            total = inn + outc if params.view != "sent" else outc
            out["stats"] = {"title": "Toplam", "note": "", "total": total, "received": inn, "sent": outc}
        if params.q and plan.stat != "count":
            out["stats"]["note"] = (out["stats"].get("note") + " · " if out["stats"].get("note") else "") + \
                "Anahtar kelime istatistiklerde yok sayıldı"
        return out
    out["search"] = search(db, meili, params, with_facets=True)
    return out


def _params_dict(p: SearchParams) -> dict:
    d = {k: v for k, v in asdict(p).items() if v not in (None, "", False) and k not in ("page", "per_page")}
    for k in ("date_from", "date_to"):
        if k in d:
            d[k] = d[k].isoformat()
    if p.has_attachment is False:
        d["has_attachment"] = False
    return json.loads(json.dumps(d, default=str))
