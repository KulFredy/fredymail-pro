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
            "adapter": "adaptor", "card": "karti", "kart": "karti", "memory": "hafiza"}


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
    # "75mm" -> 75, mm ; "100w" -> 100, w ; kodlar (a063z, k200w) olduğu gibi kalır
    m = re.fullmatch(r"(\d+(?:\.\d+)?)([a-z]{1,3})", tok)
    return [m.group(1), m.group(2)] if m else [tok]


def tokens(text: str) -> list[str]:
    out: list[str] = []
    for t in re.split(r"[^a-z0-9]+", fold(text or "")):
        if t:
            out += [SYNONYMS.get(x, x) for x in _split_units(t)]
    return out


def model_codes(text: str) -> set[str]:
    """Harf ve rakam içeren, en az 4 karakterlik parçalar: A063Z, B091S, K200W, PLM111, CRB200.

    Sayı+birim (75mm, 32gb, 100w, 5000mah) model kodu sayılmaz.
    """
    return {t for t in re.split(r"[^a-z0-9]+", fold(text or ""))
            if len(t) >= 4 and re.search(r"[a-z]", t) and re.search(r"\d", t)
            and not re.fullmatch(r"\d+(?:\.\d+)?[a-z]{1,3}", t)}


def code_shape(t: str) -> str:
    """a063s -> 'adddа' biçimi: harf=a, rakam=d (b091s ile aynı, cr133 ile farklı)."""
    return re.sub(r"\d", "d", re.sub(r"[a-z]", "a", t))


def _codeish(t: str) -> bool:
    return (len(t) >= 4 and bool(re.search(r"[a-z]", t)) and bool(re.search(r"\d", t))) or bool(re.fullmatch(r"\d{4,}", t))


@dataclass
class SiteProduct:
    url: str
    slug: str
    toks: set[str] = field(default_factory=set)


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

    Sıra: (1) marka mağazada hiç yoksa → yok; (2) ürün numarası/model kodu mağazada geçiyorsa birebir eşleşme;
    markanın linkleri kod içerdiği hâlde kod mağazada hiç yoksa → yok (yeni model, ör. Tamron B091S);
    (3) kelime örtüşmesi (mağazada hiç geçmeyen iç kodlar ve bölge ekleri sayılmaz), eşitlikte varyant kelimesi.
    """

    def __init__(self, urls: list[str]):
        self.products = []
        for u in urls:
            slug = urlparse(u).path.rstrip("/").rsplit("/", 1)[-1]
            self.products.append(SiteProduct(u, slug, set(tokens(slug.replace("-", " ")))))
        self.vocab: set[str] = set().union(*(p.toks for p in self.products)) if self.products else set()

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

    def match(self, name: str, brand: str | None = None, code: str | None = None) -> Match:
        sets = _brand_token_sets(brand)
        brand_toks = set().union(*sets) if sets else set()
        pool = self.brand_pool(brand)
        if pool is None:
            pool = self.products
        elif not pool:
            return Match(None, "missing")  # marka mağazada hiç yok

        ids = self._ids(name, sets)
        if ids:
            pool_vocab = set().union(*(p.toks for p in pool))
            known = ids & pool_vocab
            if known:
                hits = [p for p in pool if known & p.toks]
                if len(hits) == 1:
                    return Match(hits[0].url, "found", 1.0)
                best = self._best(name, hits, brand_toks, min_score=0.0)
                return best if best.status == "found" else Match(None, "ambiguous", best.score)
            # Kod mağazada yok. Markanın linkleri AYNI BİÇİMDE kodlar taşıyorsa (Tamron: a063s ~ b091s) bu yeni bir
            # modeldir. Biçim farklıysa (Zhiyun iç kodu cr133, Patona numarası 1259) kelime eşleştirmesine geçilir.
            shapes = {code_shape(i) for i in ids}
            same = sum(1 for p in pool if any(code_shape(t) in shapes for t in p.toks if _codeish(t)))
            if pool and same / len(pool) >= 0.3:
                return Match(None, "missing")
        return self._best(name, pool, brand_toks)

    def _best(self, name: str, pool: list[SiteProduct], brand_toks: set[str], min_score: float = 0.75) -> Match:
        toks = tokens(name)
        variant = {t for t in toks if t in VARIANT}
        want = {t for t in toks if t not in STOP and t not in NOISE and t not in VARIANT
                and not (len(t) == 1 and t.isalpha()) and t in self.vocab} - brand_toks
        if not want or not pool:
            return Match(None, "missing")

        def jacc(p: SiteProduct) -> float:
            other = p.toks - brand_toks - STOP - VARIANT
            return len(want & other) / len(want | other) if other else 0.0

        scored = [(len(want & p.toks) / len(want), p) for p in pool]
        top = max(s for s, _ in scored)
        if top < min_score:
            return Match(None, "missing", top)
        cands = [p for s, p in scored if s == top]
        if len(cands) > 1:  # varyant: önce birebir aynı varyant kelimeleri, sonra kapsayan, sonra kesişen
            exact = [p for p in cands if (p.toks & VARIANT) == variant]
            narrowed = exact or ([p for p in cands if variant <= p.toks] if variant else []) \
                or ([p for p in cands if variant & p.toks] if variant else [])
            cands = narrowed or cands
        cands.sort(key=jacc, reverse=True)
        if len(cands) > 1 and jacc(cands[0]) == jacc(cands[1]):
            return Match(None, "ambiguous", top)
        return Match(cands[0].url, "found", top)

    def explain(self, name: str, brand: str | None = None, n: int = 2) -> list[tuple[float, str]]:
        """Teşhis: markanın mağazadaki ürünleri arasında kelime örtüşmesi en yüksek `n` aday (puan, link adı)."""
        sets = _brand_token_sets(brand)
        brand_toks = set().union(*sets) if sets else set()
        pool = self.brand_pool(brand) or []
        want = {t for t in tokens(name) if t not in STOP and t not in NOISE and t not in VARIANT
                and not (len(t) == 1 and t.isalpha())} - brand_toks
        if not want or not pool:
            return []
        scored = sorted(((len(want & p.toks) / len(want), p.slug) for p in pool), reverse=True)
        return scored[:n]

