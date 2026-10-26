import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { navigate, EMPTY_SEARCH } from "./route";
import { useStore } from "./store";
import type { Draft } from "./types";
import { fmtListDate } from "./util";
import { Banner, Empty, Icon, Skeleton } from "./ui";

export function DraftsPage({ draftId, onMenu }: { draftId: number | null; onMenu: () => void }) {
  const [list, setList] = useState<Draft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    api.get<Draft[]>("/api/drafts").then(setList).catch((e: ApiError) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  const sel = list?.find((d) => d.id === draftId) ?? null;

  return (
    <div className={`two-pane ${draftId ? "has-detail" : ""}`}>
      <section className="list-pane" aria-label="Taslaklar">
        <header className="list-head">
          <div className="row gap-sm">
            <button className="icon-btn only-mobile" onClick={onMenu} aria-label="Menüyü aç"><Icon name="menu" /></button>
            <h1>Taslaklar</h1>
          </div>
          {list && <span className="muted small">{list.length} taslak</span>}
        </header>
        <Banner kind="info">FredyMail mail göndermez. Taslağı gözden geçirip kopyalayın ve Outlook'ta gönderin.</Banner>
        {error && <Banner kind="error">{error} <button className="link" onClick={load}>Tekrar dene</button></Banner>}
        <div className="list-scroll" role="listbox" aria-label="Taslak listesi">
          {!list && !error && <Skeleton rows={4} />}
          {list && !list.length && <Empty icon="draft" title="Taslak yok">Bir mailin AI panelinden “Yanıt taslağı” oluşturabilirsiniz.</Empty>}
          {list?.map((d) => (
            <div key={d.id} role="option" aria-selected={d.id === draftId} tabIndex={0} className={`mrow ${d.id === draftId ? "selected" : ""}`}
              onClick={() => navigate({ page: "drafts", draft: d.id })}
              onKeyDown={(e) => e.key === "Enter" && navigate({ page: "drafts", draft: d.id })}>
              <div className="row-main">
                <div className="row-top">
                  <span className="row-from">{d.to.join(", ") || "(alıcı yok)"}</span>
                  <span className="row-date">{fmtListDate(d.updated_at)}</span>
                </div>
                <div className="row-subject">{d.subject || "(konu yok)"}</div>
                <div className="row-snippet">{d.body.slice(0, 140)}</div>
                <div className="row-meta">
                  {d.source === "ai" && <span className="pill ai"><Icon name="sparkle" size={12} /> AI</span>}
                  <span className={`pill ${d.reviewed ? "ok" : "warn"}`}>{d.reviewed ? "Gözden geçirildi" : "Gözden geçirilmedi"}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
      {sel ? (
        <DraftEditor key={sel.id} draft={sel} onSaved={(d) => setList((l) => l?.map((x) => (x.id === d.id ? d : x)) ?? null)} onDeleted={() => { load(); navigate({ page: "drafts", draft: null }); }} />
      ) : (
        <section className="reader empty-reader"><Empty icon="draft" title={draftId ? "Taslak bulunamadı" : "Bir taslak seçin"} /></section>
      )}
    </div>
  );
}

function DraftEditor({ draft, onSaved, onDeleted }: { draft: Draft; onSaved: (d: Draft) => void; onDeleted: () => void }) {
  const [to, setTo] = useState(draft.to.join(", "));
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [reviewed, setReviewed] = useState(draft.reviewed);
  const [saving, setSaving] = useState(false);
  const { toast, refreshCounts } = useStore();
  const dirty = to !== draft.to.join(", ") || subject !== draft.subject || body !== draft.body || reviewed !== draft.reviewed;

  async function save() {
    setSaving(true);
    try {
      const d = await api.patch<Draft>(`/api/drafts/${draft.id}`, { to: to.split(/[,;\s]+/).filter(Boolean), subject, body, reviewed });
      onSaved(d);
      toast("Taslak kaydedildi", "ok");
    } catch (e) {
      toast((e as ApiError).message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function copy() {
    const text = `Konu: ${subject}\n\n${body}`;
    try {
      await navigator.clipboard.writeText(text);
      toast("Panoya kopyalandı. Outlook'ta yeni yanıta yapıştırabilirsiniz.", "ok");
    } catch {
      toast("Kopyalanamadı; metni seçip elle kopyalayın.", "error");
    }
  }

  return (
    <section className="reader" aria-label="Taslak düzenleyici">
      <div className="reader-toolbar">
        <button className="icon-btn only-mobile" onClick={() => navigate({ page: "drafts", draft: null })} aria-label="Geri"><Icon name="back" /></button>
        <strong>Taslak</strong>
        <div className="toolbar-actions">
          {draft.reply_to_message_id && (
            <button className="btn sm ghost" onClick={() => navigate({ page: "mail", search: { ...EMPTY_SEARCH, view: "all" }, msg: draft.reply_to_message_id })}>
              Orijinal maili aç
            </button>
          )}
          <button className="btn sm danger-ghost" onClick={async () => {
            if (!window.confirm("Taslak silinsin mi?")) return;
            await api.del(`/api/drafts/${draft.id}`).catch(() => undefined);
            refreshCounts();
            onDeleted();
          }}><Icon name="trash" size={14} /> Sil</button>
        </div>
      </div>
      <div className="reader-scroll pad">
        <Banner kind="warn">
          <strong>Bu bir taslaktır ve gönderilmez.</strong> {draft.source === "ai" && "AI tarafından üretildi; rakamları, tarihleri ve [köşeli parantez] yer tutucularını kontrol edin. "}
          Hazır olduğunda kopyalayıp Outlook'tan gönderin.
        </Banner>
        <label className="field">
          <span>Kime</span>
          <input value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="field">
          <span>Konu</span>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label className="field">
          <span>Metin</span>
          <textarea className="draft-body" rows={16} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
          Gözden geçirdim (içerik ve alıcılar doğru)
        </label>
        <div className="row gap wrap mt">
          <button className="btn primary" onClick={save} disabled={!dirty || saving}>{saving ? "Kaydediliyor…" : "Kaydet"}</button>
          <button className="btn" onClick={copy}><Icon name="copy" size={15} /> Panoya kopyala</button>
          {!reviewed && <span className="muted small">Kopyalamadan önce gözden geçirip işaretleyin.</span>}
        </div>
      </div>
    </section>
  );
}
