"""Kamera log → Rec.709 dönüşüm LUT'larını üretir (assets/luts/kamera/*.cube).

Üretim: python -m venv v && v/bin/pip install colour-science && v/bin/python scripts/gen-luts.py
Girdi alanı: tarayıcının çözdüğü RGB (sınırlı aralıklı video tam aralığa açılmış hâli).
Adımlar: log eğrisi çözülür → sahne doğrusal → kamera gamı'ndan Rec.709'a →
filmik ton eğrisi (ACES yaklaşık, %18 gri ≈ 0.44) → ekran kodlaması (gamma 2.4).
"""
import inspect, json, os, sys
import numpy as np
import colour

N = 33
OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "luts", "kamera")

PROFILES = [
    ("sony-slog3-sgamut3cine", "Sony S-Log3 / S-Gamut3.Cine", "S-Log3", "S-Gamut3.Cine"),
    ("sony-slog3-sgamut3", "Sony S-Log3 / S-Gamut3", "S-Log3", "S-Gamut3"),
    ("sony-slog2-sgamut", "Sony S-Log2 / S-Gamut", "S-Log2", "S-Gamut"),
    ("panasonic-vlog", "Panasonic V-Log / V-Gamut", "V-Log", "V-Gamut"),
    ("canon-clog3", "Canon Log 3 / Cinema Gamut", "Canon Log 3", "Cinema Gamut"),
    ("canon-clog2", "Canon Log 2 / Cinema Gamut", "Canon Log 2", "Cinema Gamut"),
    ("fujifilm-flog", "Fujifilm F-Log / F-Gamut", "F-Log", "F-Gamut"),
    ("fujifilm-flog2", "Fujifilm F-Log2 / F-Gamut", "F-Log2", "F-Gamut"),
    ("nikon-nlog", "Nikon N-Log / BT.2020", "N-Log", "ITU-R BT.2020"),
    ("dji-dlog", "DJI D-Log / D-Gamut", "D-Log", "DJI D-Gamut"),
    ("apple-log", "Apple Log / BT.2020", "Apple Log Profile", "ITU-R BT.2020"),
    ("arri-logc3", "ARRI LogC3 / AWG3", "ARRI LogC3", "ARRI Wide Gamut 3"),
]


def tone(x):
    x = np.maximum(x * 0.6, 0.0)
    y = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)
    return np.clip(y, 0.0, 1.0) ** (1 / 2.4)


def build(curve, gamut):
    g = np.linspace(0, 1, N)
    b, gg, r = np.meshgrid(g, g, g, indexing="ij")  # kırmızı en hızlı değişen
    rgb = np.stack([r, gg, b], axis=-1).reshape(-1, 3)
    dec = colour.LOG_DECODINGS[curve]
    kw = {}
    if "in_normalised_code_value" in inspect.signature(dec).parameters:
        kw["in_normalised_code_value"] = False
    lin = dec(rgb, **kw)
    cs = colour.RGB_COLOURSPACES[gamut]
    rec709 = colour.RGB_to_RGB(lin, cs, colour.RGB_COLOURSPACES["ITU-R BT.709"],
                               chromatic_adaptation_transform=None)
    return tone(rec709)


def main():
    os.makedirs(OUT, exist_ok=True)
    index = []
    for pid, title, curve, gamut in PROFILES:
        data = build(curve, gamut)
        with open(os.path.join(OUT, pid + ".cube"), "w") as f:
            f.write(f'TITLE "{title} → Rec.709 (İçerik Fabrikası)"\nLUT_3D_SIZE {N}\n')
            for row in data:
                f.write(f"{row[0]:.5f} {row[1]:.5f} {row[2]:.5f}\n")
        enc = colour.LOG_ENCODINGS[curve]
        kw = {"out_normalised_code_value": False} if "out_normalised_code_value" in inspect.signature(enc).parameters else {}
        g18 = float(enc(0.18, **kw))
        index.append({"id": pid, "title": title, "curve": curve, "gamut": gamut, "grey18": round(g18, 4)})
        print(pid, "gri18 log:", round(g18, 3), "→ ekran:", round(float(tone(np.array([0.18]))[0]), 3))
    with open(os.path.join(OUT, "index.json"), "w") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
