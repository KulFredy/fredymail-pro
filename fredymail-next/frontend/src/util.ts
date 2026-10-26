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

export function avatarColor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 45% 46%)`;
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
