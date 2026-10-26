import { useState } from "react";
import { api, ApiError } from "./api";
import { useStore, type ComposeInit } from "./store";
import { mailtoHref } from "./util";
import { Banner, Icon, Modal } from "./ui";

/** Yazma penceresi. FredyMail göndermez: metin mail programında açılır veya panoya kopyalanır. */
export function Composer({ init, onClose }: { init: ComposeInit; onClose: () => void }) {
  const [to, setTo] = useState(init.to.join(", "));
  const [subject, setSubject] = useState(init.subject);
  const [body, setBody] = useState(init.body);
  const [saving, setSaving] = useState(false);
  const [draftId, setDraftId] = useState<number | undefined>(init.draftId ?? undefined);
  const { toast, refreshCounts } = useStore();
  const list = to.split(/[,;\s]+/).filter(Boolean);
  const m = mailtoHref(list, subject, body);

  async function copy() {
    try {
      await navigator.clipboard.writeText(`Konu: ${subject}\n\n${body}`);
      toast("Panoya kopyalandı", "ok");
    } catch {
      toast("Kopyalanamadı; metni seçip elle kopyalayın.", "error");
    }
  }

  async function save() {
    setSaving(true);
    try {
      if (draftId) {
        await api.patch(`/api/drafts/${draftId}`, { to: list, subject, body, reviewed: true });
      } else {
        const d = await api.post<{ id: number }>("/api/drafts", {
          to: list, subject, body, reply_to_message_id: init.replyToMessageId ?? null,
        });
        setDraftId(d.id);
      }
      refreshCounts();
      toast("Taslak kaydedildi", "ok");
    } catch (e) {
      toast((e as ApiError).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={init.replyToMessageId ? "Yanıt yaz" : "Yeni taslak"} onClose={onClose} wide>
      {init.source === "ai" && (
        <Banner kind="warn">AI tarafından hazırlandı. Rakamları, tarihleri ve [köşeli parantez] yer tutucularını kontrol edin.</Banner>
      )}
      <label className="field">
        <span>Kime</span>
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="ad@firma.com" autoComplete="off" />
      </label>
      <label className="field">
        <span>Konu</span>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} />
      </label>
      <label className="field">
        <span>Metin</span>
        <textarea rows={12} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Merhaba," />
      </label>
      <div className="row gap-sm wrap">
        <a className="btn dark" href={m.href} data-testid="composer-mailto"><Icon name="external" size={15} /> E-posta programında aç</a>
        <button className="btn" onClick={copy}><Icon name="copy" size={15} /> Panoya kopyala</button>
        <button className="btn ghost" onClick={save} disabled={saving}>{saving ? "Kaydediliyor…" : "Taslağı kaydet"}</button>
      </div>
      <p className="muted xs mt">
        FredyMail mail göndermez. {m.truncated ? "Metin uzun olduğu için mail programında kısaltılır; tamamı için kopyalayın. " : ""}
        Taslaklar yalnızca FredyMail'de saklanır.
      </p>
    </Modal>
  );
}
