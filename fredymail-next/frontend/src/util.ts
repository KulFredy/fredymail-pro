import { brandName } from "./brand";

const HL_PRE = "";
const HL_POST = "";

export interface HlPart {
  text: string;
  hit: boolean;
}

/** Meilisearch vurgulama işaretlerine göre metni parçalar (HTML olarak yorumlanmaz). */
export function splitHighlight(s: string | null | undefined): HlPart[] {
  if (!s) return [];
  const out: HlPart[] = [];
  let rest = s;
  while (rest.length) {
    const a = rest.indexOf(HL_PRE);
    if (a < 0) {
      out.push({ text: rest, hit: false });
      break;
    }
    if (a > 0) out.push({ text: rest.slice(0, a), hit: false });
    const b = rest.indexOf(HL_POST, a + 1);
    if (b < 0) {
      out.push({ text: rest.slice(a + 1), hit: true });
      break;
    }
    out.push({ text: rest.slice(a + 1, b), hit: true });
    rest = rest.slice(b + 1);
  }
  return out;
}

export function stripHighlight(s: string | null | undefined): string {
  return (s ?? "").split(HL_PRE).join("").split(HL_POST).join("");
}

const dtTime = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" });
const dtDay = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short" });
const dtFull = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" });
const dtLong = new Intl.DateTimeFormat("tr-TR", {
  weekday: "short",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function fmtListDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return dtTime.format(d);
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Dün";
  if (d.getFullYear() === now.getFullYear()) return dtDay.format(d);
  return dtFull.format(d);
}

export function fmtLongDate(iso: string | null): string {
  return iso ? dtLong.format(new Date(iso)) : "tarih yok";
}

export function fmtRelative(iso: string | null): string {
  if (!iso) return "";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "az önce";
  if (diff < 3600) return `${Math.round(diff / 60)} dk önce`;
  if (diff < 86400) return `${Math.round(diff / 3600)} sa önce`;
  return `${Math.round(diff / 86400)} gün önce`;
}

export function fmtSize(n: number | null | undefined): string {
  if (!n && n !== 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function initials(name: string, email: string): string {
  const src = (name || email || "?").replace(/["']/g, "").trim();
  const parts = src.split(/[\s.@_-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toLocaleUpperCase("tr-TR");
}

const AVATAR = ["#0f7a4f", "#2c5fb4", "#a63369", "#b5630b", "#6a43c2", "#12707b", "#b4373a", "#4d6b7d", "#3d7a1f", "#8a4fb0"];

export function avatarColor(seed: string): string {
  let h = 0;
  for (const ch of seed.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR[h % AVATAR.length];
}

export const ROLE_LABEL: Record<string, string> = {
  inbox: "Gelen Kutusu",
  sent: "Gönderilen",
  archive: "Arşiv",
  drafts: "Taslaklar",
  trash: "Çöp",
  junk: "Spam",
};

export function folderLabel(f: { display_name: string; role: string | null; name?: string }): string {
  return (f.role && ROLE_LABEL[f.role]) || f.display_name;
}

export const FILE_ICON: Record<string, string> = {
  pdf: "PDF",
  spreadsheet: "XLS",
  document: "DOC",
  presentation: "PPT",
  image: "IMG",
  archive: "ZIP",
  einvoice: "XML",
  email: "EML",
  other: "DOS",
};

export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** Erteleme seçenekleri için hazır zamanlar. */
export function snoozePresets(): { label: string; at: Date }[] {
  const now = new Date();
  const in3h = new Date(now.getTime() + 3 * 3600 * 1000);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const monday = new Date(now);
  const add = ((8 - now.getDay()) % 7) || 7;
  monday.setDate(now.getDate() + add);
  monday.setHours(9, 0, 0, 0);
  const week = new Date(now.getTime() + 7 * 86400 * 1000);
  week.setHours(9, 0, 0, 0);
  return [
    { label: "3 saat sonra", at: in3h },
    { label: "Yarın 09:00", at: tomorrow },
    { label: "Pazartesi 09:00", at: monday },
    { label: "1 hafta sonra", at: week },
  ];
}

export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Soru gibi görünen girdiler "Sor" moduna gider. */
export function isQuestion(text: string): boolean {
  const t = text.trim().toLocaleLowerCase("tr-TR");
  if (!t) return false;
  if (t.endsWith("?")) return true;
  return /^(kim|kime|kimden|kaç|hangi|ne |neler|nedir|en çok|en az|nerede|ne zaman|göster|listele)/.test(t);
}

export const ASK_SUGGESTIONS = [
  "Bu ay en çok kimden mail aldım?",
  "Hangi firmalarla en çok yazıştım bu yıl?",
  "Bu hafta kaç mail geldi?",
  "Son 30 gün cevaplanmamış mailler",
  "Aylara göre mail dağılımı",
  "2025 fiyat listeleri pdf",
];

/** Bilgisayarın mail programında açmak için mailto: bağlantısı (uzun metin kırpılır). */
export const MAILTO_MAX = 1800;
export function mailtoHref(to: string[] | string, subject: string, body: string): { href: string; truncated: boolean } {
  const list = (Array.isArray(to) ? to : to.split(/[,;\s]+/)).filter(Boolean);
  let b = body;
  let truncated = false;
  if (b.length > MAILTO_MAX) {
    b = `${b.slice(0, MAILTO_MAX).trimEnd()}…\n\n[Metnin devamı kısaltıldı — tamamını ${brandName()} içinde "Panoya kopyala" ile alın.]`;
    truncated = true;
  }
  const q = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(b)}`;
  return { href: `mailto:${list.map(encodeURIComponent).join(",")}?${q}`, truncated };
}

export function todayKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(n: number, d = new Date()): string {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return todayKey(x);
}

/** Görev son tarihi → etiket + renk. */
export function dueInfo(due: string | null): { label: string; tone: "red" | "green" | "grey" } | null {
  if (!due) return null;
  const today = todayKey();
  if (due < today) return { label: `Gecikti · ${fmtDay(due)}`, tone: "red" };
  if (due === today) return { label: "Bugün", tone: "red" };
  if (due === addDays(1)) return { label: "Yarın", tone: "green" };
  return { label: fmtDay(due), tone: "grey" };
}

export function fmtDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", ...(y !== new Date().getFullYear() ? { year: "numeric" } : {}) }).format(dt);
}

/** AI'nin önerdiği tarihi (varsa) ISO güne çevirir. */
/** Modelin "belirtilmemiş" gibi tarih olmayan değerleri (eski önbellekteki sonuçlar için). */
export function isNoDue(s: string | null | undefined): boolean {
  return !s || /^(belirtilme(miş|di)|yok|bilinmiyor|tarih yok|none|null|n\/?a|unspecified|unknown|tbd|-+|—)$/i.test(s.trim());
}

export function parseDue(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim().toLocaleLowerCase("tr-TR");
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  if (t.includes("bugün") || t === "today") return todayKey();
  if (t.includes("yarın") || t === "tomorrow") return addDays(1);
  return null;
}

export function daysTone(days: number | null): "red" | "amber" | "green" | "grey" {
  if (days == null) return "grey";
  if (days >= 3) return "red";
  if (days >= 1) return "amber";
  return "green";
}

export function daysLabel(days: number | null): string {
  if (days == null) return "—";
  if (days <= 0) return "Bugün";
  return `${days} gün`;
}

export function domainOf(email: string): string {
  return (email.split("@")[1] ?? "").toLowerCase();
}

/** Günün saatine göre selamlama. */
export function greeting(): string {
  const h = new Date().getHours();
  return h < 6 ? "İyi geceler" : h < 12 ? "Günaydın" : h < 18 ? "İyi günler" : "İyi akşamlar";
}

export function fmtNum(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("tr-TR");
}

/** Tarayıcıya kişisel küçük tercih (panel açık/kapalı vb.); depolama kapalıysa sessizce varsayılan. */
export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* özel pencere vb. — tercih hatırlanmaz */
  }
}
