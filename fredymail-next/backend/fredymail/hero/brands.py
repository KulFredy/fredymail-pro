"""Marka adlarını kaynaklar arasında eşleştirir.

Yoldaki Mallar sekme adları ("OM", "KODAK SD", "KF CONCEPT"), Hero listesindeki marka adları
("OM System", "Kodak") ve marketing tablosundaki adlar ("K&F CONCEPT") aynı markayı farklı yazar.
Hepsi buradaki tek bir kanonik ada indirgenir.
"""

from __future__ import annotations

import re

from ..mail.classify import fold

# kanonik ad -> eş adlar (fold edilmiş karşılaştırılır; kanonik adın kendisi de eşleşir)
BRANDS: dict[str, tuple[str, ...]] = {
    "OM System": ("OM", "OM SYSTEM", "OLYMPUS"),
    "Kodak": ("KODAK SD",),
    "SJCam": (),
    "Lemorele": (),
    "Desview": (),
    "Yashica": (),
    "Transcend": (),
    "PolarPro": ("POLAR PRO",),
    "Yaber": (),
    "Zhiyun": (),
    "Cinepeer": (),
    "Tilta": (),
    "Saramonic": (),
    "Viltrox": (),
    "Patona": (),
    "K&F Concept": ("KF CONCEPT", "K&F", "KENTFAITH"),
    "Verbatim": (),
    "Tamron": (),
    "Sekonic": (),
    "Manfrotto": (),
    "Lowepro": (),
    "Lastolite": (),
    "Laowa": ("VENUS OPTICS",),
    "Profoto": (),
    "B+W": ("B&W",),
    "Duracell": (),
    "Kingjoy": (),
    "Delkin Devices": ("DELKIN",),
    "Portkeys": (),
}

# Birden çok markayı tek sekmede toplayan sekmeler: marka satırdan (marka hücresi veya ürün adı) okunur.
GROUP_SHEETS = frozenset({"videndum", "bt-tech"})


def _key(s: str) -> str:
    return re.sub(r"\s+", " ", fold(s or "")).strip()


_ALIASES: dict[str, str] = {}
for _canon, _alts in BRANDS.items():
    for _a in (_canon, *_alts):
        _ALIASES[_key(_a)] = _canon


def canonical(name: str) -> str | None:
    """Tam eşleşme: 'KODAK SD' -> 'Kodak'. Bilinmeyen ad için None."""
    return _ALIASES.get(_key(name))


def from_product_name(name: str) -> str | None:
    """Ürün adının başındaki markayı bulur: 'Manfrotto 035 Süper Clamp' -> 'Manfrotto'."""
    k = _key(name)
    best: tuple[int, str] | None = None
    for alias, canon in _ALIASES.items():
        if k == alias or k.startswith(alias + " "):
            if best is None or len(alias) > best[0]:
                best = (len(alias), canon)
    return best[1] if best else None
