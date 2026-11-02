"""Mağaza (shop.zoomithalat.com, IdeaSoft) ürün linkleri: "ürün sitede var mı, linki ne?".

Yalnızca site haritası okunur (ürün sayfaları taranmaz): /sitemap.xml → /xml/sitemap_product_N.xml → /urun/<slug>.
robots.txt'deki `Crawl-delay: 30` kuralına uyulur: istekler arasında 30 sn beklenir, günde bir kez çalışır.

Eşleştirme ürün linkindeki ada (slug) göre yapılır; slug marka, model kodu ve ürün adını içerir:
    /urun/tamron-a063s-28-75-mm-sony-f-2-8-di-iii-vxd-g2
Model kodu (harf+rakam, ör. A063Z) varsa slug'da birebir aranır (A063S ≠ A063Z: farklı bağlantı tipi = farklı ürün).
Kod yoksa anlamlı kelimelerin örtüşmesine bakılır. Emin olunamayan durumda "eşleşme yok" yerine "belirsiz" denir.
"""

from __future__ import annotations

import re
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from urllib.parse import urlparse

import httpx

from ..mail.classify import fold

USER_AGENT = "FredyMail-Hero/1.0 (urun linki kontrolu; gunde 1 kez)"
_LOC = re.compile(r"<loc>\s*([^<\s]+)\s*</loc>")

# Eşleştirmede sayılmayan genel kelimeler (TR/EN, fold edilmiş)
STOP = frozenset("""
lens lensi zoom full frame mount mm for ile ve icin set adet the and with of kamera camera premium standart standard
""".split())
# Bölge/paket ekleri: yoldaki adlarında var, mağaza linklerinde olmaz (EUR/INT/CN…)
NOISE = frozenset("eur int cn tr us uk eu ver version".split())
# Varyant kelimeleri: ürünü değil varyantı ayırır. Puana girmez, yalnızca eşit adaylar arasında seçim yapar
# (Kodak kart Kırmızı/Sarı, TG-7 Siyah/Kırmızı, Weebill 5 / Weebill 5 Combo).
VARIANT = frozenset("""
siyah black beyaz white silver gumus gri gray grey kirmizi red yesil green mavi blue sari yellow khaki haki beige bej
turuncu orange pembe pink mor purple combo kit
""".split())
# Yoldaki adları çoğu zaman İngilizce, mağaza linkleri Türkçe
SYNONYMS = {"battery": "batarya", "batery": "batarya", "akku": "batarya", "charger": "sarj", "light": "isik",
            "lights": "isik", "backpack": "canta", "bag": "canta", "bags": "canta", "case": "canta",
            "adapter": "adaptor", "card": "karti", "kart": "karti", "memory": "hafiza", "charging": "sarj",
            # renkler: varyant seçimi diller arasında çalışsın
            "black": "siyah", "noir": "siyah", "white": "beyaz", "grey": "gri", "gray": "gri", "red": "kirmizi",
            "yellow": "sari", "blue": "mavi", "green": "yesil", "orange": "turuncu", "pink": "pembe"}


class SiteError(Exception):
    pass


def fetch_product_urls(base: str, http: httpx.Client | None = None, delay: float = 30.0,
                       sleep: Callable[[float], None] = time.sleep) -> list[str]:
    """Site haritası dizininden ürün haritalarını, onlardan da /urun/ linklerini toplar."""
    http = http or httpx.Client(timeout=30, follow_redirects=True, headers={"User-Agent": USER_AGENT})
    base = base.rstrip("/")

    def get(url: str) -> str:
        r = http.get(url)
        if r.status_code != 200:
            raise SiteError(f"{urlparse(url).path} okunamadı (HTTP {r.status_code})")
        return r.text

    index = _LOC.findall(get(f"{base}/sitemap.xml"))
    product_maps = [u.replace("&amp;", "&") for u in index if "sitemap_product" in u]
    if not product_maps:
        raise SiteError("site haritasında ürün haritası (sitemap_product) bulunamadı")
    urls: list[str] = []
    for u in product_maps:
        sleep(delay)
        urls += [x for x in _LOC.findall(get(u)) if "/urun/" in x]
    return sorted(set(urls))


def _split_units(tok: str) -> list[str]:
    # "75mm" -> 75mm, 75, mm ; kod gibi görünenler (1051bac, 046mc) bütün hâliyle de kalır
    m = re.fullmatch(r"(\d+(?:\.\d+)?)([a-z]{1,3})", tok)
    return [tok, m.group(1), m.group(2)] if m else [tok]


def tokens(text: str) -> list[str]:
    raw = [t for t in re.split(r"[^a-z0-9]+", fold(text or "")) if t]
    out: list[str] = []
    for i, t in enumerate(raw):
        if t == "type" and i + 1 < len(raw) and len(raw[i + 1]) == 1:  # CFexpress "Type A" ≠ "Type B"
            out.append("type" + raw[i + 1])
        if t == "cfexpress":
            out += ["cf", "express"]
        if t == "v" and i + 1 < len(raw) and raw[i + 1] == "mount":  # V-Mount batarya/şarj
            out.append("vmount")
        out += [SYNONYMS.get(x, x) for x in _split_units(t)]
    return out


# IdeaSoft link sonundaki ürün numarası ("…-hafiza-karti-8967") ve kopya ekleri ürün adına ait değildir
_SLUG_TAIL = re.compile(r"(-kopya)?(-\d{3,6})?(-kopya)?$")


def clean_slug(slug: str) -> str:
    return _SLUG_TAIL.sub("", slug)


def model_codes(text: str) -> set[str]:
    """Harf ve rakam içeren, en az 4 karakterlik parçalar: A063Z, B091S, K200W, PLM111, 1051BAC.

    Sayı+birim (75mm, 32gb, 100w, 5000mah) model kodu sayılmaz.
    """
    return {t for t in re.split(r"[^a-z0-9]+", fold(text or ""))
            if len(t) >= 4 and re.search(r"[a-z]", t) and re.search(r"\d", t)
            and not re.fullmatch(r"\d+(?:\.\d+)?(mm|gb|tb|mb|w|wh|mah|v|cm|m|k|mp|hz|x)", t)}


def code_shape(t: str) -> str:
    """Kod kalıbı: harf grupları=a, rakam grupları=d. a063s → 'ada' (b091s, wt4s ile aynı); fv70 → 'ad' (fw50 ile aynı)."""
    return re.sub(r"\d+", "d", re.sub(r"[a-z]+", "a", t))


# Ürün tipi kelimeleri: farklı tipte ilan aday olamaz (şarj aleti ≠ batarya, çanta ≠ tripod)
TYPES = frozenset("batarya sarj powerbank adaptor canta tripod monopod baslik kart karti bellek lens mikrofon gimbal "
                  "isik softbox projeksiyon kulaklik".split())
ROMAN = frozenset("ii iii iv vi vii".split())


def name_compounds(name: str) -> set[str]:
    """Tireli kodlar birleştirilir: 'PL-RL-H55' → plrlh55, 'MHXPRO-3W' → mhxpro3w (harf ve rakam içeren, ≥5)."""
    out = set()
    for chunk in re.split(r"[\s/,+()（）]+", fold(name)):
        parts = [x for x in re.split(r"[^a-z0-9]+", chunk) if x]
        joined = "".join(parts)
        if len(parts) >= 2 and len(joined) >= 5 and re.search(r"[a-z]", joined) and re.search(r"\d", joined):
            out.add(joined)
    return out


def slug_compounds(slug: str) -> set[str]:
    """Linkteki ardışık 2-4 parçanın birleşimleri: 'mb-pl-rl-h55-reloader' → {mbpl, plrl, plrlh55, …}."""
    parts = slug.split("-")
    return {"".join(parts[i:i + n]) for n in (2, 3, 4) for i in range(len(parts) - n + 1)}


@dataclass
class SiteProduct:
    url: str
    slug: str
    toks: set[str] = field(default_factory=set)
    codes: set[str] = field(default_factory=set)
    compounds: set[str] = field(default_factory=set)


@dataclass
class Match:
    url: str | None
    status: str  # found | missing | ambiguous
    score: float = 0.0


def _brand_token_sets(brand: str | None) -> list[set[str]]:
    from .brands import BRANDS, canonical

    if not brand:
        return []
    canon = canonical(brand) or brand
    names = [canon, *BRANDS.get(canon, ())]
    sets = [set(tokens(n)) - STOP for n in names]
    return [x for x in sets if x]


class SiteIndex:
    """Mağaza linkleri üzerinde ürün arama.

    (1) Marka mağazada hiç yoksa → yok. (2) Ürünün model kodu/numarası mağazada geçiyorsa o linkler arasından seçilir.
    (3) Değilse kelime eşleştirmesi: nadir kelimeler (model adları: adventura, mkonepa) yaygın kelimelerden
    (batarya, çanta) daha ağır basar (IDF ağırlığı); mağazada hiç geçmeyen iç kodlar ve bölge ekleri sayılmaz;
    ürünün kodundan FARKLI ama aynı biçimde kod taşıyan linkler (Tamron a063s ↔ b091s) aday olamaz.
    Eşit adaylar arasında varyant kelimesi (renk, combo) seçer; aynı ürünün iki ilanı varsa ilki alınır.
    """

    def __init__(self, urls: list[str]):
        import math

        self.products = []
        for u in urls:
            slug = clean_slug(urlparse(u).path.rstrip("/").rsplit("/", 1)[-1])
            text = slug.replace("-", " ")
            self.products.append(SiteProduct(u, slug, set(tokens(text)), model_codes(text), slug_compounds(slug)))
        self.vocab: set[str] = set().union(*(p.toks for p in self.products)) if self.products else set()
        df: dict[str, int] = {}
        for p in self.products:
            for t in p.toks:
                df[t] = df.get(t, 0) + 1
        n = max(len(self.products), 1)
        self.idf = {t: math.log((n + 1) / (c + 0.5)) for t, c in df.items()}

    def __len__(self) -> int:
        return len(self.products)

    def brand_pool(self, brand: str | None) -> list[SiteProduct] | None:
        sets = _brand_token_sets(brand)
        if not sets:
            return None
        return [p for p in self.products if any(bs <= p.toks for bs in sets)]

    @staticmethod
    def _ids(name: str, brand_sets: list[set[str]]) -> set[str]:
        ids = set(model_codes(name))
        folded = re.split(r"[^a-z0-9]+", fold(name))
        brand_words = {w for bs in brand_sets for w in bs}
        for i, t in enumerate(folded[:3]):  # "Patona 1259 …" / "Patona1395 …": markadan hemen sonraki numara
            m = re.fullmatch(r"([a-z]*)(\d{4,})", t)
            if m and (m.group(1) in brand_words or (m.group(1) == "" and i > 0 and folded[i - 1] in brand_words)):
                ids.add(m.group(2))
        return ids

    @staticmethod
    def _type_ok(name_toks: set[str], p: SiteProduct) -> bool:
        mine = name_toks & TYPES
        theirs = p.toks & TYPES
        return not mine or not theirs or bool(mine & theirs)

    def match(self, name: str, brand: str | None = None, code: str | None = None) -> Match:
        sets = _brand_token_sets(brand)
        brand_toks = set().union(*sets) if sets else set()
        pool = self.brand_pool(brand)
        if pool is None:
            pool = self.products
        elif not pool:
            return Match(None, "missing")  # marka mağazada hiç yok
        name_toks = set(tokens(name))
        pool = [p for p in pool if self._type_ok(name_toks, p)]

        ids = self._ids(name, sets)
        comps = name_compounds(name)
        has = lambda p, k: k in p.toks or k in p.compounds  # noqa: E731
        known = {i for i in ids | comps if any(has(p, i) for p in pool)}
        # Parantez dışındaki bilinmeyen kodlar (parantez içi tedarikçi kodları: CR133, PLB102 sayılmaz)
        outside = self._ids(self._PARENS.sub(" ", name), sets)
        unknown = {i for i in outside - known if not i.isdigit()}
        if unknown:  # aynı kalıpta BAŞKA kod taşıyan ilanlar başka modeldir (b091s ↔ a063s, wt8s ↔ wt4s)
            shapes = {code_shape(i) for i in unknown}
            pool = [p for p in pool if any(has(p, k) for k in known)
                    or not any(code_shape(c) in shapes and c not in ids for c in p.codes)]
        if known:
            hits = [p for p in pool if any(has(p, k) for k in known)]
            # Nadir ve kesin kod (manfrotto 1051bac, mt055cxpro3, pl-rl-h55; patona 1195): ürünün kimliğidir,
            # açıklama kelimeleri önemsizdir
            rare = [i for i in known if sum(has(p, i) for p in pool) <= 2
                    and (sum(c.isdigit() for c in i) >= 2 or len(i) >= 6)]
            if hits and rare:
                rare_hits = [p for p in hits if any(has(p, i) for i in rare)]
                best = self._best(name, rare_hits, brand_toks, min_score=0.0, ids=ids)
                if best.status != "missing":
                    return best
            if hits:
                best = self._best(name, hits, brand_toks, ids=ids)
                if best.status == "found":
                    return best
                return Match(None, "ambiguous" if best.score >= 0.55 else "missing", best.score)
        return self._best(name, pool, brand_toks, ids=ids)

    # Mağazada geçmese de ayırt edici olan kelimeler: yok sayılmaz, eşleşmezse puanı düşürür
    _DISTINCT = re.compile(r"type[a-z]|\d+(gb|tb)|ii|iii|iv|vi|vii")
    _UNIT = re.compile(r"\d+(?:\.\d+)?(mm|gb|tb|mb|w|wh|mah|v|cm|m|k|mp|hz)")
    _PARENS = re.compile(r"[(（\[][^)）\]]*[)）\]]")

    def _want(self, name: str, brand_toks: set[str], ids: set[str] | None = None) -> tuple[dict[str, float], set[str]]:
        """Aranan kelimeler ve ağırlıkları.

        Mağazada geçen kelime: IDF ağırlığı. Mağazada HİÇ geçmeyen kelime yeni bir modele işaret edebilir, bu yüzden
        yok sayılmaz (eşleşmez, puanı düşürür): model kodu/numarası (wt8s, vt 1500, vbd58) tam ağırlıkla, model adı
        (fastback) orta ağırlıkla. Yok sayılanlar: parantez içindeki iç kodlar/ekler (CR133, PLX110/EUR), ürün
        numarası (Patona 1259), sayı+birim parçaları (5000mAh), genel/bölge kelimeleri.
        """
        import statistics

        variant = {t for t in tokens(name) if t in VARIANT}
        inside = set(tokens(" ".join(self._PARENS.findall(name))))
        outside_raw = [t for t in re.split(r"[^a-z0-9]+", fold(self._PARENS.sub(" ", name))) if t]
        unit_parts = {x for r in outside_raw if self._UNIT.fullmatch(r) for x in _split_units(r)[1:]}
        top = max(self.idf.values(), default=1.0)
        mid = statistics.median(self.idf.values()) if self.idf else 1.0
        want: dict[str, float] = {}
        for t in tokens(name):
            if t in STOP or t in NOISE or t in VARIANT or t in brand_toks or t in want or re.fullmatch(r"f\d{1,2}", t):
                continue  # f2 / f4: diyafram (F2.8), rakamlar ayrıca sayılır
            if t in self.vocab:
                want[t] = self.idf[t]
            elif self._DISTINCT.fullmatch(t):
                want[t] = top
            elif t in inside or (t.isdigit() and t in (ids or set())) or t in unit_parts or self._UNIT.fullmatch(t):
                continue
            elif any(c.isdigit() for c in t):
                want[t] = top
            elif len(t) >= 4:
                want[t] = mid
        for t in [t for t in want if len(t) == 1 and t.isalpha()]:  # tek harfler kelime sayılmaz
            del want[t]
        return want, variant

    def _veto(self, want: dict[str, float], ids: set[str] | None, name_toks: set[str], best: SiteProduct) -> set[str]:
        """Eşleşmeyi reddettiren parçalar.

        - Roma rakamı farkı (AW II ≠ AW III), mağazada geçse bile.
        - Mağazada hiç geçmeyen sayı / kısa kod (Autarc 1800, VT 1500): o ilan bu ürün değildir. Model kodları (kalıp
          kuralı ayrıca bakar), kapasite (16gb: aynı ürün ailesi) ve batarya/şarj adlarındaki uyumlu kamera listeleri
          (S30-S70, EOS-450D) hariç.
        """
        out = {t for t in want if t in ROMAN and t not in best.toks and best.toks & ROMAN}
        if name_toks & {"batarya", "sarj", "powerbank"}:
            return out
        return out | {t for t in want if t not in self.vocab and t not in (ids or set())
                      and not re.fullmatch(r"\d+(gb|tb)", t)
                      and (t.isdigit() or (len(t) <= 3 and any(c.isdigit() for c in t)))}

    def _score(self, want: dict[str, float], p: SiteProduct, variant: set[str] | None = None) -> float:
        total = sum(want.values())
        score = sum(w for t, w in want.items() if t in p.toks) / total if total else 0.0
        pv = p.toks & VARIANT  # renk/combo uyumu küçük artı; ürünün adında olmayan varyant küçük eksi
        if variant:
            score += 0.1 * len(variant & pv) / len(variant)
        if pv - (variant or set()):
            score -= 0.1
        return round(score, 6)

    def _best(self, name: str, pool: list[SiteProduct], brand_toks: set[str], min_score: float = 0.75,
              ids: set[str] | None = None) -> Match:
        """Eşleşme: puan ≥ 0,75 ya da (puan ≥ 0,55 ve ikinci farklı adaydan en az 0,10 önde)."""
        want, variant = self._want(name, brand_toks, ids)
        if not want or not pool:
            return Match(None, "missing")

        def jacc(p: SiteProduct) -> float:
            other = p.toks - brand_toks - STOP - VARIANT
            return len(want.keys() & other) / len(want.keys() | other) if other else 0.0

        scored = sorted(((self._score(want, p, variant), jacc(p), p) for p in pool),
                        key=lambda x: (x[0], x[1]), reverse=True)
        top, top_j, best = scored[0]
        if min_score and len(want.keys() & best.toks) < 2:  # tek ortak kelimeyle eşleşme olmaz
            return Match(None, "missing", top)
        if min_score and self._veto(want, ids, set(tokens(name)), best):
            return Match(None, "missing", top)
        # Objektif odak aralığı ürünün kimliğidir: 16-50mm ilanı 16-30mm olamaz
        for lo, hi in re.findall(r"(\d+)\s*-\s*(\d+)\s*mm", fold(name)):
            if lo not in best.toks or hi not in best.toks:
                return Match(None, "missing", top)
        rival = next(((s, j) for s, j, p in scored[1:] if p.toks != best.toks), None)
        margin = top - rival[0] if rival else 1.0
        if min_score and top < min_score and not (top >= 0.55 and margin >= 0.095):
            return Match(None, "missing", top)
        if rival and margin == 0 and rival[1] == top_j:
            return Match(None, "ambiguous", top)
        return Match(best.url, "found", top)

    def explain(self, name: str, brand: str | None = None, n: int = 2) -> list[tuple[float, str]]:
        """Teşhis: markanın mağazadaki ürünleri arasında ağırlıklı puanı en yüksek `n` aday (puan, link adı)."""
        sets = _brand_token_sets(brand)
        brand_toks = set().union(*sets) if sets else set()
        pool = self.brand_pool(brand) or []
        want, variant = self._want(name, brand_toks, self._ids(name, sets))
        if not want or not pool:
            return []
        return sorted(((round(self._score(want, p, variant), 2), p.slug) for p in pool), reverse=True)[:n]
