# fredymail-pro

## Apify

Web'den veri toplama gerektiren işlerde (işletme/lead bulma, iletişim bilgisi çıkarma, site içeriği tarama, sosyal medya, yorumlar) kullanıcı ayrıca söylemese de Apify kullan.

- Önce `apify` MCP araçlarını dene. Yüklü değilse REST API ile çalış: `https://api.apify.com/v2`.
- Cloud oturumlarında `APIFY_TOKEN` ortam değişkeni olmayabilir; ağ proxy'si `*.apify.com` isteklerine kimlik bilgisini kendisi ekler. `Authorization: Bearer ${APIFY_TOKEN:-proxy-injected}` başlığıyla istek at. Token'ı asla yazdırma veya dosyaya yazma.
- Actor çalıştırma: `POST /v2/acts/<kullanıcı>~<actor>/run-sync-get-dataset-items?maxTotalChargeUsd=<tavan>` gövdede Actor girdisiyle.
- Hesap FREE planda (aylık $5 kredi). Çalıştırmadan önce Actor'ın `pricingInfos` bilgisinden tahmini maliyeti hesapla:
  - Tahmin $0.10 altındaysa doğrudan çalıştır, sonuçla birlikte maliyeti bildir.
  - Üstündeyse maliyeti söyle ve onay al.
  - Her çalıştırmaya `maxTotalChargeUsd` tavanı koy; ücret artıran ek seçenekleri (lead, e-posta doğrulama, sosyal profil) istenmedikçe kapalı tut.
- Sık kullanılanlar:
  - `compass/crawler-google-places`: Google Maps işletmeleri (FREE: $0.004/yer)
  - `vdrmota/contact-info-scraper`: sitelerden e-posta/telefon
  - `apify/website-content-crawler`: site içeriği (ücretsiz Actor, platform kullanımı ücretli)
- Toplanan kişisel verilerle (e-posta, telefon) toplu gönderim önerirken KVKK/GDPR ve spam kurallarını hatırlat.
