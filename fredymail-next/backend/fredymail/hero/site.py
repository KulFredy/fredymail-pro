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
lens lensi zoom full frame mount mm for ile ve icin kit black siyah beyaz white silver gri gray grey kirmizi red
yesil green mavi blue sari yellow pro premium standart standard set adet the and with of combo kamera camera
""".split())


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
            out += _split_units(t)
    return out


def model_codes(text: str) -> set[str]:
    """Harf ve rakam içeren, en az 4 karakterlik parçalar: A063Z, B091S, K200W, PLM111, CRB200.

    Sayı+birim (75mm, 32gb, 100w, 5000mah) model kodu sayılmaz.
    """
    return {t for t in re.split(r"[^a-z0-9]+", fold(text or ""))
            if len(t) >= 4 and re.search(r"[a-z]", t) and re.search(r"\d", t)
            and not re.fullmatch(r"\d+(?:\.\d+)?[a-z]{1,3}", t)}


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


class SiteIndex:
    def __init__(self, urls: list[str]):
        self.products = []
        for u in urls:
            slug = urlparse(u).path.rstrip("/").rsplit("/", 1)[-1]
            self.products.append(SiteProduct(u, slug, set(tokens(slug.replace("-", " ")))))

    def __len__(self) -> int:
        return len(self.products)

    def match(self, name: str, brand: str | None = None, code: str | None = None) -> Match:
        brand_toks = set(tokens(brand or "")) - STOP
        pool = self.products
        if brand_toks:
            branded = [p for p in pool if brand_toks <= p.toks]
            pool = branded or pool
        # 1) model kodu: slug'da birebir geçmeli
        codes = model_codes(name)
        if codes:
            hits = [p for p in pool if codes & p.toks]
            if len(hits) == 1:
                return Match(hits[0].url, "found", 1.0)
            if len(hits) > 1:
                best = self._best(name, hits, brand_toks)
                return best if best.status == "found" else Match(None, "ambiguous", best.score)
        # 2) anlamlı kelime örtüşmesi
        return self._best(name, pool, brand_toks)

    def _best(self, name: str, pool: list[SiteProduct], brand_toks: set[str]) -> Match:
        want = {t for t in tokens(name) if t not in STOP} - brand_toks
        if not want:
            return Match(None, "missing")
        scored = sorted(((len(want & p.toks) / len(want), -len(p.toks), p) for p in pool),
                        key=lambda x: (x[0], x[1]), reverse=True)
        if not scored or scored[0][0] < 0.75:
            return Match(None, "missing", scored[0][0] if scored else 0.0)
        top = scored[0]
        if len(scored) > 1 and scored[1][0] == top[0] and scored[1][1] == top[1]:
            return Match(None, "ambiguous", top[0])
        return Match(top[2].url, "found", top[0])
