/** Bir maile sağ tıklayınca çıkan menü (liste, Yanıt Bekleyenler, Asistan sonuçları aynı menüyü kullanır).
 *  Tüm işlemler yalnız FredyMail içindedir; posta sunucusuna yazılmaz. */
import { api, ApiError } from "./api";
import { requestIntel, SEP, type MenuItem } from "./contextmenu";
import { replySubject, replyTarget } from "./Reader";
import { goMail } from "./route";
import type { ComposeInit } from "./store";
import type { MessageItem, Tag } from "./types";
import { snoozePresets } from "./util";

export interface MailMenuDeps {
  open: () => void;
  onUpdated?: (m: MessageItem) => void;
  toast: (text: string, kind?: "info" | "ok" | "error") => void;
  tags: Tag[];
  me: string[];
  aiEnabled: boolean;
  openComposer: (c: ComposeInit) => void;
  refreshFolders: () => void;
  refreshTags: () => void;
  refreshCounts: () => void;
  extra?: MenuItem[];
}

export function mailMenu(m: MessageItem, d: MailMenuDeps): MenuItem[] {
  const act = async (p: Promise<MessageItem | unknown>, ok?: string, after?: () => void) => {
    try {
      const u = await p;
      if (u && typeof u === "object" && "id" in u) d.onUpdated?.(u as MessageItem);
      if (ok) d.toast(ok, "ok");
      after?.();
    } catch (e) {
      d.toast((e as ApiError).message, "error");
    }
  };
  const patch = (body: { is_read?: boolean; is_important?: boolean; snoozed_until?: string; clear_snooze?: boolean },
    ok?: string, after?: () => void) => {
    // okundu/önemli değişikliği anında görünsün; sunucu yanıtı gelince kesinleşir, hata olursa geri alınır
    const quick: Partial<MessageItem> = {};
    if (body.is_read !== undefined) quick.is_read = body.is_read;
    if (body.is_important !== undefined) quick.is_important = body.is_important;
    if (Object.keys(quick).length) d.onUpdated?.({ ...m, ...quick });
    return act(api.patch<MessageItem>(`/api/messages/${m.id}`, body).catch((e) => { d.onUpdated?.(m); throw e; }), ok, after);
  };
  const other = m.is_from_me ? m.to[0]?.email ?? "" : m.from_email;
  const has = new Set(m.tags.map((t) => t.id));
  const copy = (text: string, what: string) =>
    navigator.clipboard.writeText(text).then(() => d.toast(`${what} kopyalandı`, "ok"), () => d.toast("Kopyalanamadı", "error"));

  const items: MenuItem[] = [
    { label: "Aç", icon: "unread", onClick: d.open },
  ];
  if (d.aiEnabled) {
    items.push(
      { label: "Yapay zekâ ile analiz et", icon: "sparkle", onClick: () => { requestIntel(m.id, "analyze"); d.open(); } },
      { label: "Yanıt taslağı oluştur (AI)", icon: "edit", onClick: () => { requestIntel(m.id, "draft"); d.open(); } },
    );
  }
  items.push(
    { label: "Yanıtla", icon: "reply", onClick: () => d.openComposer({ to: replyTarget(m, d.me), subject: replySubject(m.subject), body: "", replyToMessageId: m.id }) },
    ...(d.extra?.length ? [SEP, ...d.extra] : []),
    SEP,
    m.is_read
      ? { label: "Okunmadı olarak işaretle", icon: "unread", onClick: () => patch({ is_read: false }, undefined, d.refreshFolders) }
      : { label: "Okundu olarak işaretle", icon: "check", onClick: () => patch({ is_read: true }, undefined, d.refreshFolders) },
    { label: m.is_important ? "Önemli işaretini kaldır" : "Önemli olarak işaretle", icon: "star", onClick: () => patch({ is_important: !m.is_important }) },
    {
      label: "Ertele", icon: "clock", sub: [
        ...snoozePresets().map((s) => ({ label: s.label, onClick: () => patch({ snoozed_until: s.at.toISOString() }, "Ertelendi; zamanı gelince gelen kutusuna döner") })),
        ...(m.snoozed_until ? [SEP, { label: "Ertelemeyi kaldır", onClick: () => patch({ clear_snooze: true }, "Erteleme kaldırıldı") }] : []),
      ],
    },
    {
      label: "Etiketle", icon: "tag", sub: [
        ...d.tags.map((t) => ({
          label: t.name, checked: has.has(t.id),
          onClick: () => act(has.has(t.id) ? api.del(`/api/messages/${m.id}/tags/${t.id}`) : api.post(`/api/messages/${m.id}/tags`, { tag_id: t.id }),
            undefined, d.refreshTags),
        })),
        ...(d.tags.length ? [SEP] : []),
        {
          label: "Yeni etiket…", icon: "plus", onClick: () => {
            const name = window.prompt("Yeni etiket adı:")?.trim();
            if (name) act(api.post(`/api/messages/${m.id}/tags`, { name }), `“${name}” etiketi eklendi`, d.refreshTags);
          },
        },
      ],
    },
    SEP,
  );
  if (other) {
    items.push(
      { label: "Bu kişiyle tüm yazışmalar", icon: "user", onClick: () => goMail({ view: "all", participant: other }) },
      ...(!m.is_from_me ? [{ label: "Bu kişiden gelen tüm mailler", icon: "inbox", onClick: () => goMail({ view: "all", sender: other }) }] : []),
      ...(!m.is_from_me ? [{
        label: "Yanıt Bekleyenler'de gösterme", icon: "close", onClick: () => {
          if (window.confirm(`${other} adresinden gelenler Yanıt Bekleyenler'de gösterilmesin mi?\n(Ayarlar'dan geri alınabilir.)`)) {
            act(api.post("/api/followups/muted", { email: other, muted: true }), "Takip listelerinden çıkarıldı", d.refreshCounts);
          }
        },
      }] : []),
    );
  }
  items.push({
    label: "Kopyala", icon: "copy", sub: [
      { label: "Konu", onClick: () => copy(m.subject || "", "Konu") },
      ...(other ? [{ label: "E-posta adresi", onClick: () => copy(other, "Adres") }] : []),
    ],
  });
  return items;
}
