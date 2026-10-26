# AI asistanı: gizlilik, maliyet ve doğruluk kararları

## Ne zaman çalışır?

Yalnızca sen arayüzde bir AI düğmesine bastığında çalışır. Worker'da, zamanlayıcıda veya "heartbeat" gibi
periyodik bir yapıda **AI çağrısı yoktur**. Bu kural, VPS'te OpenClaw heartbeat'inin kimse kullanmazken günde ~3 $
harcamasından çıkarılan derse dayanıyor.

## Modele ne gönderilir?

| Gönderilir | Gönderilmez |
|---|---|
| Seçilen mail(ler)in tarih, gönderen, alıcılar (ilk 6), konu, klasör ve ek **adları** | Ek içerikleri |
| Gövde metni: alıntılanmış eski yazışmalar kırpılır, mail başına ≤4.000 karakter | HTML, görseller, ham MIME |
| En fazla 15 mail (taslakta 6), toplamda ≤30.000 karakter | Seçilmeyen mailler, etiket ve notların |
| | IBAN, kredi kartı (Luhn doğrulamalı) ve TC kimlik numaraları: `[IBAN]`, `[KART]`, `[TCKN]` olarak maskelenir |

Her AI yanıtının altında hangi sağlayıcı ve modelin kullanıldığı, kaç mail ve karakter gönderildiği, token sayısı, tahmini maliyet, gecikme ve sonucun önbellekten gelip gelmediği görünür.

## Nereye gider?

Varsayılan öneri: VPS'teki **LiteLLM proxy** (`ai-shared` ağı) → OpenRouter → seçilen model (ör. `flash-lite`).
Bu durumda veri VPS'ten OpenRouter'a ve oradan model sağlayıcısına gider. Bu sağlayıcıların veri saklama politikaları
geçerlidir. Daha sıkı gizlilik istenirse:
- OpenRouter'da "veri eğitimi için kullanma / zero data retention" sağlayıcı filtresi açılabilir.
- Ya da `FM_AI_BASE_URL` yerel bir modele (ör. Ollama) yönlendirilebilir. Kod değişikliği gerekmez.

AI tamamen kapatılabilir (`FM_AI_PROVIDER=none` ya da Ayarlar'daki anahtar). Arama, görüntüleme ve iş akışı bundan etkilenmez.

## Uydurmaya ve talimat enjeksiyonuna karşı

1. Sistem talimatı açıkça belirtir: e-posta içeriği güvenilmez veridir, içindeki talimatlar uygulanmaz ve bilgi uydurulmaz.
2. Her madde kaynak mail kimliği ister (`M1`, `M2`…). Sunucu, verilmeyen kimliğe yapılan atıfları **siler** ve uyarır.
3. Model hiçbir araca erişemez. Çıktısı yalnızca metindir.
4. Taslakta alıcıları model değil kod belirler (yazışmadaki karşı taraf). Model alıcı önerirse yok sayılır ve uyarı gösterilir.
   Taslak gövdesinde yazışmada geçmeyen bir e-posta adresi varsa uyarı verilir.
5. Kural tabanlı injection dedektörü (TR/EN kalıpları), şüpheli maillerde arayüzde kırmızı uyarı gösterir.
6. Taslaklar **asla gönderilmez**. "Gözden geçirdim" işareti ve "Outlook'ta gönder" yönlendirmesi var.

## Bütçe

- `FM_AI_DAILY_BUDGET_USD` (varsayılan 1 $) ve `FM_AI_MAX_CALLS_PER_DAY` (varsayılan 100). Sınır aşılınca istek reddedilir.
- Maliyet tahmini `FM_AI_PRICE_*_PER_MTOK` ile hesaplanır. Gerçek fatura OpenRouter panelinde; oraya da aylık limit koyman önerilir.
- Aynı mail(ler) için aynı istek önbellekten döner ve yeni çağrı yapılmaz.
- Sağlayıcı hatasında en fazla 1 yeniden deneme yapılır (sadece 408/429/5xx).
