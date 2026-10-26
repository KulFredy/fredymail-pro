import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { navigate, type SearchState } from "./route";
import { useStore } from "./store";
import type { AiRef, AiResult, MessageDetail } from "./types";
import { fmtListDate } from "./util";
import { Banner, Icon, Spinner } from "./ui";

type Kind = "summary" | "thread_summary" | "actions" | "draft" | "search_summary";

const LABELS: Record<Kind, string> = {
  summary: "Maili özetle",
  thread_summary: "Yazışmayı özetle",
  actions: "Yapılacakları çıkar",
  draft: "Yanıt taslağı",
  search_summary: "Arama sonuçlarını özetle",
};

interface Props {
  message: MessageDetail;
  threadId: number | null;
  threadCount: number;
  search: SearchState | null;
  auto: string | null;
  onAutoDone: () => void;
  onOpenMessage: (id: number) => void;
}

export function AiPanel(p: Props) {
  const { ai, refreshAi, refreshCounts, toast } = useStore();
  const [kind, setKind] = useState<Kind | null>(null);
  const [result, setResult] = useState<AiResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [instruction, setInstruction] = useState("");

  useEffect(() => {
    setResult(null);
    setError(null);
    setKind(null);
  }, [p.message.id]);

  useEffect(() => {
    if (p.auto && ai?.enabled) {
      run(p.auto as Kind);
      p.onAutoDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.auto, ai?.enabled]);

  async function run(k: Kind) {
    setKind(k);
    setBusy(true);
    setError(null);
    setResult(null);
    const body: Record<string, unknown> = { message_id: p.message.id };
    if (k === "thread_summary" || k === "actions" || k === "draft") body.thread_id = p.threadId;
    if (k === "draft") body.instruction = instruction;
    if (k === "search_summary" && p.search) {
      const { q, smart: _s, ...rest } = p.search;
      void _s;
      body.query = q;
      body.filters = Object.fromEntries(Object.entries(rest).filter(([key, v]) => v !== "" && key !== "sort" && !(key === "view" && (v === "all" || v === "folder"))));
    }
    try {
      const out = await api.post<AiResult>(`/api/ai/${k}`, body);
      setResult(out);
      refreshAi();
      if (k === "draft" && out.draft_id) {
        refreshCounts();
        toast("Taslak oluşturuldu. Gözden geçirmeden kullanmayın; FredyMail göndermez.", "ok");
      }
    } catch (e) {
      const ae = e as ApiError;
      setError(ae.status === 409 ? ae.message : ae.status === 502 ? `AI şu an yanıt vermiyor: ${ae.message}` : ae.message);
    } finally {
      setBusy(false);
    }
  }

  if (!ai) return <div className="pad"><Spinner label="AI durumu alınıyor…" /></div>;

  if (!ai.enabled) {
    return (
      <div className="ai-panel">
        <Banner kind="info">
          <strong>AI kapalı.</strong> Arama, mail görüntüleme, etiket, not ve erteleme normal çalışır.{" "}
          {ai.configured ? "Ayarlar sayfasından tekrar açabilirsiniz." : "Bir AI sağlayıcısı yapılandırılmamış (FM_AI_PROVIDER)."}{" "}
          <button className="link" onClick={() => navigate({ page: "settings" })}>Ayarlar</button>
        </Banner>
      </div>
    );
  }

  const refs = new Map((result?.references ?? []).map((r) => [r.label, r]));
  const hasSearch = !!(p.search && (p.search.q || p.search.doc_kind || p.search.sender));

  return (
    <div className="ai-panel">
      <div className="ai-actions">
        <button className="btn" onClick={() => run("summary")} disabled={busy}><Icon name="sparkle" size={15} /> {LABELS.summary}</button>
        {p.threadCount > 1 && <button className="btn" onClick={() => run("thread_summary")} disabled={busy}>{LABELS.thread_summary}</button>}
        <button className="btn" onClick={() => run("actions")} disabled={busy}>{LABELS.actions}</button>
        {hasSearch && <button className="btn" onClick={() => run("search_summary")} disabled={busy}>{LABELS.search_summary}</button>}
      </div>
      <div className="ai-draft">
        <label className="field">
          <span>Yanıt taslağı için isteğiniz (isteğe bağlı)</span>
          <textarea rows={2} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="ör. Nazikçe teşekkür et, teslim tarihini sor, kısa tut" />
        </label>
        <button className="btn primary" onClick={() => run("draft")} disabled={busy}><Icon name="draft" size={15} /> Taslak hazırla</button>
        <p className="muted small">Taslak yalnızca kaydedilir; FredyMail hiçbir maili göndermez.</p>
      </div>

      {busy && <Spinner label={`${kind ? LABELS[kind] : "AI"} hazırlanıyor…`} />}
      {error && <Banner kind="error">{error}</Banner>}

      {result && (
        <div className="ai-result" aria-live="polite">
          <h2>{kind ? LABELS[kind] : "Sonuç"}</h2>
          {result.warnings.length > 0 && (
            <Banner kind="warn">
              <ul className="plain">
                {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </Banner>
          )}
          {result.summary && <p className="ai-summary"><Cited text={result.summary} refs={refs} onOpen={p.onOpenMessage} /></p>}
          {result.key_points && result.key_points.length > 0 && (
            <>
              <h3>Önemli noktalar</h3>
              <ul className="ai-list">
                {result.key_points.map((k, i) => (
                  <li key={i}><Cited text={k.text} refs={refs} onOpen={p.onOpenMessage} /> <Sources ids={k.sources} refs={refs} onOpen={p.onOpenMessage} /></li>
                ))}
              </ul>
            </>
          )}
          {result.actions && result.actions.length > 0 && (
            <>
              <h3>Yapılacaklar</h3>
              <ul className="ai-list">
                {result.actions.map((a, i) => (
                  <li key={i}>
                    <Cited text={a.task} refs={refs} onOpen={p.onOpenMessage} />
                    {(a.owner || a.due) && <span className="muted small"> · {[a.owner, a.due].filter(Boolean).join(" · ")}</span>}{" "}
                    <Sources ids={a.sources} refs={refs} onOpen={p.onOpenMessage} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {kind === "draft" && result.body !== undefined && (
            <div className="draft-preview">
              <div className="muted small">Kime: {(result.to ?? []).join(", ") || "—"} (yazışmadan belirlendi)</div>
              <div className="draft-subject">{result.subject}</div>
              <pre className="body-text">{result.body}</pre>
              <Sources ids={result.sources ?? []} refs={refs} onOpen={p.onOpenMessage} />
              {result.draft_id && (
                <button className="btn primary" onClick={() => navigate({ page: "drafts", draft: result.draft_id! })}>
                  Taslağı düzenle
                </button>
              )}
            </div>
          )}
          {result.references.length > 0 && (
            <>
              <h3>Kaynak mailler</h3>
              <ul className="refs">
                {result.references.map((r) => (
                  <li key={r.label}>
                    <button className={`ref ${result.cited.includes(r.label) ? "cited" : ""}`} onClick={() => p.onOpenMessage(r.message_id)}>
                      <span className="src-chip">{r.label}</span>
                      <span className="ellipsis">{r.subject}</span>
                      <span className="muted small nowrap">{r.from} · {fmtListDate(r.date)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {result.meta && (
            <div className="ai-meta" aria-label="AI çağrı ayrıntıları">
              {result.meta.cached ? "Önbellekten (ek maliyet yok) · " : ""}
              {result.meta.provider}/{result.meta.model}
              {result.meta.messages_sent != null && ` · ${result.meta.messages_sent} mail, ${result.meta.chars_sent?.toLocaleString("tr-TR")} karakter gönderildi`}
              {result.meta.prompt_tokens != null && ` · ${result.meta.prompt_tokens}+${result.meta.completion_tokens} token`}
              {result.meta.cost_usd != null && ` · ~$${result.meta.cost_usd.toFixed(4)}`}
              {result.meta.latency_ms != null && ` · ${(result.meta.latency_ms / 1000).toFixed(1)} sn`}
              {result.meta.pii_redacted && " · IBAN/kart/TCKN maskelendi"}
            </div>
          )}
        </div>
      )}

      <div className="ai-foot muted small">
        Bugün: {ai.usage_today.calls}/{ai.limits.max_calls_per_day} çağrı · ${ai.usage_today.cost_usd.toFixed(3)} / ${ai.limits.daily_budget_usd.toFixed(2)} bütçe ·
        en fazla {ai.limits.max_messages} mail gönderilir, ekler gönderilmez.
      </div>
    </div>
  );
}

function Cited({ text, refs, onOpen }: { text: string; refs: Map<string, AiRef>; onOpen: (id: number) => void }) {
  const parts = text.split(/(\[M\d+\])/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = /^\[(M\d+)\]$/.exec(part);
        if (!m) return <span key={i}>{part}</span>;
        const r = refs.get(m[1]);
        if (!r) return null;
        return (
          <button key={i} className="src-chip" onClick={() => onOpen(r.message_id)} title={`${r.subject} — ${r.from}`}>
            {m[1]}
          </button>
        );
      })}
    </>
  );
}

function Sources({ ids, refs, onOpen }: { ids: string[]; refs: Map<string, AiRef>; onOpen: (id: number) => void }) {
  if (!ids.length) return <span className="muted small">(kaynak yok)</span>;
  return (
    <span className="sources">
      {ids.map((id) => {
        const r = refs.get(id);
        return r ? (
          <button key={id} className="src-chip" onClick={() => onOpen(r.message_id)} title={`${r.subject} — ${r.from} — ${fmtListDate(r.date)}`}>
            {id}
          </button>
        ) : null;
      })}
    </span>
  );
}
