"""Gerçek mağaza (shop.zoomithalat.com) linklerinden bir örneklem ile eşleştirme doğrulaması.

Linkler 2.11.2026 `hero-site --explain` çıktısından alınmıştır (herkese açık ürün adresleri).
Beklentiler o çıktıdaki yanlış "sitede yok" sonuçlarına göre yazıldı.
"""

from __future__ import annotations

import pytest

from fredymail.hero.site import SiteIndex

SLUGS = """
kingjoy-vx-600d-3-wheel-dolly-7830 kingjoy-vt-890h6-video-tripod-7829
kodak-512gb-cf-express-type-b-2-0-extra-hafiza-karti-1700mb-s-1650mb-s-8967
kodak-256gb-cf-express-type-b-2-0-extra-hafiza-karti-1700mb-s-1650mb-s-8964
lowepro-fastpack-pro-bp-250-aw-iii-sirt-cantasi-gri lowepro-adventura-bp-150-iii-black-6385
lowepro-whistler-bp-450-aw-ii-grey-6579 lowepro-whistler-bp-350-aw-ii-grey-6578 lowepro-flipside-bp-300-aw-iii-black
lowepro-protactic-bp-450-aw-iii-black-noir-7606 lowepro-tahoe-bp-150-galaxy-blue-5234 lowepro-tahoe-bp-150-black
manfrotto-ma-120-adaptor-from-3-8-to-1-4 manfrotto-ma-119-adaptor-spigot-1-4f-3-8f manfrotto-ma-044-3-lu-fon-tutucu
manfrotto-ma-046mc-fon-tutucu manfrotto-mc-pixi-universal-clamp-3525 manfrotto-ma-1051bac-mini-compact-stand
manfrotto-pro-light-reloader-air-50-tasinabilir-tekerlekli-canta manfrotto-ma-1314b-set-stands-support-bag-spring
manfrotto-ma-143a-magic-arm-with-camera-bracket manfrotto-ma-143-magic-arm-kit-3384 manfrotto-ma-165mv-tripod-spreeder
manfrotto-mvkbfrt-live-befree-live-al-twt-ki-video-tripod-kit manfrotto-ma-244rc-variable-friction-arm-w-plate-3436
manfrotto-ma-244n-variable-friction-arm-alone manfrotto-bags-mb-pl-rl-h55-reloader-switch-55-rol-4290
manfrotto-bags-pl-rl-s55-reloader-spin-55-roller-4291 manfrotto-bags-mbag-75n-tripod-tasima-cantasi
manfrotto-pl2-bp-bl-s-backloader-backpack-s-sirt-cantasi
manfrotto-mkbfrla4bk-3w-befree-3-yonlu-baslik-live-advanced-aluminyum-tripod-kit manfrotto-mhxpro-3wg-tripod-basligi
manfrotto-mkonepa-3w-one-photo-ai-with-xpro-3w-head-8587 manfrotto-mkonepa-bhq6t-one-photo-ai-with-xpro-bh-8586
manfrotto-mvk500xam-500x-twin-leg-alu-video-system-8224 manfrotto-mvk500am-telescopic-twin-leg-system
manfrotto-maoneqr-xchange-adaptor-8726 tilta-manfrotto-quick-release-extender-plate-tga-mep-kopya
manfrotto-mvk612twinfa-fast-twin manfrotto-mvk608twinfa-fast-twin-5448
patona-premium-batarya-canon-nb-6l-icin patona-batarya-canon-nb-8l-icin patona-protect-batarya-canon-lp-e6nh-icin
patona-premium-batarya-canon-lp-e6n-icin patona-protect-batarya-sony-np-fz100-icin patona-premium-batarya-sony-np-fw50-icin
patona-platinum-batarya-canon-lp-e8-icin patona-senkron-lcd-ekranli-usb-sarj-cihazi-canon-lp-e8-icin-6371
patona-senkron-lcd-ekranli-usb-sarj-cihazi-nikon-en-el14-icin-6374 patona-protect-batarya-nikon-en-el14-icin
patona-premium-batarya-nikon-en-el25-icin patona-premium-batarya-sony-np-bx1-icin patona-premium-batarya-canon-bp-511-icin
patona-premium-batarya-canon-bp-a60-icin patona-premium-batarya-olympus-li-90b-icin patona-premium-batarya-olympus-li50b-icin
patona-batarya-canon-nb-12l-ile-uyumlu patona-premium-batarya-sony-bp-u60-icin patona-premium-batarya-sony-bp-u68-icin
patona-premium-batarya-canon-lp-e12-icin patona-platinum-batarya-canon-lp-e6nh-icin patona-platinum-batarya-canon-lp-e17-icin
patona-4156-platinum-retro-dual-charging-case-usb-c-canon-lp-e17-8788 patona-batarya-dji-osmo-action-ile-uyumlu
patona-premium-4-lu-sarj-cihazi-sony-np-fz100-icin-6359 patona-151676-slim-micro-usb-charger-f-canon-lp-e17-8-4v-7488
patona-senkron-lcd-ekranli-usb-sarj-cihazi-sony-np-fz100-icin-6380 patona-platinum-batarya-dji-phantom-4-icin
patona-platinum-tasinabilir-guc-istasyonu-autarc-5000-5120wh-pd100w-usb-c-usb-a-qc-ac-dc-lifepo4-6528
patona-4157-platinum-retro-dual-charging-case-usb-c-canon-lp-e6-lp-e6n-lp-e6nh-lp-e6p-8789
patona-7686-dual-lcd-usb-charger-canon-lp-e4-lp-e19-6539 patona-4169-premium-gl200m-bi-color-cob-led-studyo-isigi-200w-8649
patona-4168-premium-gl300m-bi-color-cob-led-studyo-isigi-300w-8648 patona-4292-premium-led-soft-light-3-0-sl-288arc-6711
patona-4291-premium-led-rgb-tube-photo-video-light-led-dynamic-21-6710 patona-9983-platinum-powerstation-autarc-2000-2000w-6652
patona-premium-twin-performance-pd-sarj-aleti-pd20w-adaptor-ile-fuji-np-w126-serisi-icin-6351
patona-platinum-batarya-fuji-np-w235-icin patona-platinum-batarya-sony-np-fz100-icin
saramonic-xmic-z4-usb-kondenser-mikrofon-7071 saramonic-witalk9se-5s-8323
saramonic-witalk-wt9s-cift-yonlu-kablosuz-kulaklik-6665 saramonic-witalk-wt6s-cift-yonlu-kablosuz-kulaklik-6664
saramonic-witalk9-wt4s-7602 saramonic-witalk9-wt4s-7547 saramonic-witalk9-x-9d-8800 saramonic-witalk9-x-5d-8799
tamron-a064z-16-30mm-nikon-f-2-8-di-iii-vxd-g2-z-mount-8208 tamron-a065s-70-180-mm-sony-f-2-8-di-iii-vxd-g2-6784
tamron-b060r-11-20-mm-canon-rf-f-2-8-di-iii-a-rxd-7836
tamron-17-70mm-f-2-8-di-iii-a-vc-rxd-canon-rf-mount-aps-c-zoom-lens-b070r-8725
tamron-16-30mm-f-2-8-diiii-vxd-g2-sony-uyumlu-lens tamron-f072s-90mm-sony-f-2-8-di-iii-vxd-7679
tamron-25-200mm-f-2-8-5-6-di-iii-vxd-g2-sony-lens tamron-a071sf-28-200mm-sony-f-2-8-5-6-di-iii-rxd
tamron-50-400mm-f-4-5-6-3-di-iii-vc-vxd-sony-e-mount-lens tamron-b061z-18-300-mm-nikon-f-3-5-6-3-di-iii-z-mount-aps-c-vc-vxd-8209
tamron-b061s-18-300-mm-sony-f-3-5-6-3-di-iii-aps-c-vc-vxd tamron-a063s-28-75-mm-sony-f-2-8-di-iii-vxd-g2
yaber-u12-full-hd-projeksiyon-700-ansi-7527 yaber-t2-plus-full-hd-tasinabilir-bataryali-projeksiyon-by-jbl-450-ansi-7601
kodak-512gb-uhs-i-u3-a2-v30ultra-ddr-sd-hafiza-karti-160mb-s-150mb-s-9033
kodak-256gb-uhs-i-u3-a2-v30ultra-ddr-sd-hafiza-karti-160mb-s-150mb-s-9032
kodak-64gb-2-0-metal-usb-bellek-k820-9016 kodak-32gb-2-0-metal-usb-bellek-k820-9015
kodak-32gb-micro-sd-uhs-i-u3-v30-a1-hafiza-karti-adaptor-sari-8598
kodak-32gb-micro-sd-uhs-i-u3-v30-a1-hafiza-karti-adaptor-kirmizi-8600
""".split()
IDX = SiteIndex([f"https://shop.zoomithalat.com/urun/{s}" for s in SLUGS])


@pytest.mark.parametrize(("name", "brand", "expect"), [
    ("Patona 1259 Premium Batarya Canon LP-E6N", "Patona", "premium-batarya-canon-lp-e6n-icin"),
    ("Patona 1170 Premium Batarya Sony NP-BX1", "Patona", "np-bx1"),
    ("Patona 1209 Premium Battery F. Canon Nb-6L", "Patona", "nb-6l"),
    ("Patona 1210 Premium Batarya Canon BP-511", "Patona", "bp-511"),
    ("Patona 1219 Premium Batarya Olympus Li-90B", "Patona", "li-90b"),
    ("Patona 1240 Standart Batarya Canon NB-12L", "Patona", "nb-12l"),
    ("Patona 1242 Premium Batarya Sony BP-U60", "Patona", "bp-u60"),
    ("Patona 1297 Premium Batarya Canon LP-E12", "Patona", "lp-e12"),
    ("Patona 1316 Premium Batarya Sony BP-U68", "Patona", "bp-u68"),
    ("Patona 1310 Platinum Batarya Canon LP-E8 LP-E8+", "Patona", "platinum-batarya-canon-lp-e8"),
    ("Manfrotto 1051BAC Mini Taşınabilir Havalı Işık Ayağı", "Manfrotto", "1051bac"),
    ("Manfrotto 046MC Fon Hareketi İçin Metal Zincir Seti", "Manfrotto", "046mc"),
    ("Manfrotto 165MV Video Tripod Düz Zemin Sabitleyici - Çivili Modeller İçin", "Manfrotto", "165mv"),
    ("Manfrotto 143A Magic Arm - Kamera Takılan Parça ile - Tek Hareket İle Kilitleme", "Manfrotto", "ma-143a-"),
    ("Manfrotto 1314B Taşınabilir Fon Askı Seti - Çantalı", "Manfrotto", "1314b"),
    ("Manfrotto MKONEPA-3W One Photo Ai Tripod ve Xpro 3 yönlü Başlık", "Manfrotto", "mkonepa-3w"),
    ("Manfrotto Maoneqr-Plate Xchange", "Manfrotto", "maoneqr"),
    ("Manfrotto Bags PL-RL-H55 Reloader Switch 55 Profesyonel Tekerlekli Kilitli Sırt Çantası", "Manfrotto", "rl-h55"),
    ("Lowepro Adventura BP 150 III Sırt Çantası Siyah", "Lowepro", "adventura"),
    ("Lowepro Flipside BP 300 AW III Sırt Çantası Siyah", "Lowepro", "flipside"),
    ("Lowepro Protactic BP 450 AW III Sırt Çantası Siyah", "Lowepro", "protactic"),
    ("Lowepro Tahoe BP 150 Sırt Çantası Siyah", "Lowepro", "tahoe-bp-150-black"),
    ("Tamron 25-200mm F2.8-5.6 VXD G2 Sony E Mount Full Frame Zoom Lens(A075S)", "Tamron", "25-200mm"),
    ("Tamron 50-400mm F/4.5-6.3 Di III VC VXD Sony E Mount Full Frame Telefoto Lens (A067S)", "Tamron", "50-400mm"),
    ("Tamron 16-30mm F/2.8 DI III VXD G2 Sony E Mount Full Frame Geniş Açı Zoom Lens (A064S)", "Tamron", "16-30mm"),
    ("Tamron 28-75mm F/2.8 DI III VXD G2 Sony E Mount (A063S)", "Tamron", "a063s"),
    ("WiTalk9 WT4S", "Saramonic", "witalk9-wt4s"),
])
def test_real_found(name, brand, expect):
    m = IDX.match(name, brand)
    assert m.status == "found" and expect in m.url, (m, IDX.explain(name, brand))


@pytest.mark.parametrize(("name", "brand"), [
    ("Tamron 16-50mm F2.8 A Sony E-Mount (B091S)", "Tamron"),
    ("Tamron 16-50mm F2.8 A Canon RF Mount (B091R)", "Tamron"),
    ("Yaber L3", "Yaber"),
    ("M080P", "Kingjoy"),
    ("Kodak 240GB CFexpress Type A 2.0 Extra", "Kodak"),
])
def test_real_still_new(name, brand):
    m = IDX.match(name, brand)
    assert m.status == "missing", (m, IDX.explain(name, brand))


def test_capacity_variant_not_on_site_is_ambiguous_not_new():
    # Mağazada K820'nin 32/64GB'ı var, 16GB yok: aynı ürün ailesi → yeni ürün sayılmaz
    assert IDX.match("Kodak 16GB 2.0 Metal USB Bellek (K820)", "Kodak").status == "ambiguous"
