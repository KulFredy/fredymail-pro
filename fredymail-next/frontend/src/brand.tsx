/** Marka adı sunucu ayarından gelir (FM_BRAND_NAME); kod genel kalır.
 *  Yazı logosunda addaki ilk "a" ile ondan sonraki ilk "i" yapay zekâyı (AI) temsil eder:
 *  ikisi yeşil, "i"nin noktası kıvılcım (✦). */

let brand = { name: "FredyMail", tagline: "Intelligence" };

export const brandName = () => brand.name;
export const brandTagline = () => brand.tagline;

/** Uygulama açılırken bir kez: adı al, sekme başlığını ve iPhone ana ekran adını ayarla. */
export async function loadBrand(): Promise<void> {
  try {
    const ctl = new AbortController();
    const t = window.setTimeout(() => ctl.abort(), 2500);
    const r = await fetch("/api/brand", { signal: ctl.signal, credentials: "same-origin" });
    window.clearTimeout(t);
    if (r.ok) {
      const j = (await r.json()) as { name?: string; tagline?: string };
      if (j.name) brand = { name: j.name.slice(0, 40), tagline: (j.tagline ?? "").slice(0, 60) };
    }
  } catch {
    /* ağ yoksa varsayılan ad */
  }
  document.title = brand.name;
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", brand.name);
}

function Spark() {
  return (
    <svg className="bm-spark" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 0c.9 6.2 5.8 11.1 12 12-6.2.9-11.1 5.8-12 12-.9-6.2-5.8-11.1-12-12C6.2 11.1 11.1 6.2 12 0z" />
    </svg>
  );
}

/** Yazı logosu: F[a]t[ı✦]hMail */
export function BrandMark({ name = brand.name }: { name?: string }) {
  const ia = name.indexOf("a");
  const ii = ia >= 0 ? name.indexOf("i", ia + 1) : -1;
  if (ia < 0 || ii < 0) return <span className="bm" aria-label={name}>{name}</span>;
  return (
    <span className="bm" aria-label={name}>
      <span aria-hidden="true">
        {name.slice(0, ia)}
        <span className="bm-ai">a</span>
        {name.slice(ia + 1, ii)}
        <span className="bm-ai bm-i">ı<Spark /></span>
        {name.slice(ii + 1)}
      </span>
    </span>
  );
}
