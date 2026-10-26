import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError } from "./api";
import { navigate, type SearchState } from "./route";
import { useStore } from "./store";
import type { AiRef, AiResult, MessageDetail, Task } from "./types";
import { dueInfo, fmtListDate, fmtSize, mailtoHref, parseDue } from "./util";
import { Banner, FileIcon, Icon, Spinner } from "./ui";

/** Yapay zeka çıktısındaki [M1] gibi kaynak işaretlerini tıklanabilir çiplere çevirir. */
export function Cited({ text, refs, onOpen }: { text: string; refs: Map<string, AiRef>; onOpen: (id: number) => void }) {
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
  return (
    <>
      {ids.map((id) => {
        const r = refs.get(id);
        return r ? (
          <button key={id} className="src-chip" onClick={() => onOpen(r.message_id)} title={`${r.subject} — ${r.from} — ${fmtListDate(r.date)}`}>
            {id}
          </button>
        ) : null;
      })}
    </>
  );
}

const refMap = (r: AiResult | null | undefined) => new Map((r?.references ?? []).map((x) => [x.label, x]));

export function aiError(e: unknown): string {
  const ae = e as ApiError;
  if (ae.status === 502) return `AI şu an yanıt vermiyor: ${ae.message}`;
  return ae.message;
}

/** Taslak için: mail programında aç / panoya kopyala / düzenle. Gönderim yoktur. */
export function DraftActions({ to, subject, body, draftId, replyTo, compact }: {
  to: string[];
  subject: string;
  body: string;
  draftId?: number | null;
  replyTo?: number | null;
  compact?: boolean;
}) {
  const { toast, openComposer } = useStore();
  const m = mailtoHref(to, subject, body);
  async function copy() {
    try {
      await navigator.clipboard.writeText(`Konu: ${subject}\n\n${body}`);
      toast("Panoya kopyalandı — mail programınızda yeni yanıta yapıştırabilirsiniz.", "ok");
    } catch {
      toast("Kopyalanamadı; metni seçip elle kopyalayın.", "error");
    }
  }
  return (
    <div className="row gap-sm wrap">
      <a className={`btn dark ${compact ? "sm" : ""}`} href={m.href} data-testid="mailto"
        onClick={() => m.truncated && toast("Metin uzun olduğu için kısaltıldı; tamamını “Panoya kopyala” ile alın.", "info")}>
        <Icon name="external" size={15} /> E-posta programında aç
      </a>
      <button className={`btn ${compact ? "sm" : ""}`} onClick={copy}><Icon name="copy" size={15} /> Panoya kopyala</button>
      <button className={`btn ghost ${compact ? "sm" : ""}`} onClick={() => openComposer({ to, subject, body, draftId, replyToMessageId: replyTo, source: "ai" })}>
        <Icon name="edit" size={15} /> Düzenle
      </button>
      {m.truncated && <span className="muted xs">Uzun metin mail programında kısaltılır.</span>}
    </div>
  );
}

export type IntelTrigger = { kind: "analyze" | "draft"; n: number } | null;

interface Props {
  message: MessageDetail;
  messages: MessageDetail[];
  threadId: number | null;
  trigger: IntelTrigger;
  onOpenMessage: (id: number) => void;
}

export function IntelCard(p: Props) {
  const { ai, refreshAi, refreshCounts, toast } = useStore();
  const [summary, setSummary] = useState<AiResult | null>(null);
  const [actions, setActions] = useState<AiResult | null>(null);
  const [draft, setDraft] = useState<AiResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyDraft, setBusyDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [instruction, setInstruction] = useState("");
  const [newTask, setNewTask] = useState("");
  const [showSources, setShowSources] = useState(true);
  const multi = p.messages.length > 1;

  const loadTasks = useCallback(() => {
    const q = p.threadId ? `thread_id=${p.threadId}` : `message_id=${p.message.id}`;
    api.get<Task[]>(`/api/tasks?${q}&include_done=true`).then(setTasks).catch(() => undefined);
  }, [p.threadId, p.message.id]);
  useEffect(loadTasks, [loadTasks]);

  async function analyze(quality: Quality = "auto") {
    setBusy(true);
    setError(null);
    const body = { message_id: p.message.id, thread_id: p.threadId, quality };
    const [a, b] = await Promise.allSettled([
      api.post<AiResult>(`/api/ai/${multi ? "thread_summary" : "summary"}`, body),
      api.post<AiResult>("/api/ai/actions", body),
    ]);
    if (a.status === "fulfilled") setSummary(a.value);
    if (b.status === "fulfilled") setActions(b.value);
    const fail = [a, b].find((x) => x.status === "rejected") as PromiseRejectedResult | undefined;
    if (fail) setError(aiError(fail.reason));
    setBusy(false);
    refreshAi();
  }

  async function makeDraft(quality: Quality = "auto") {
    setBusyDraft(true);
    setError(null);
    try {
      const out = await api.post<AiResult>("/api/ai/draft", { message_id: p.message.id, thread_id: p.threadId, instruction, quality });
      setDraft(out);
      refreshCounts();
      toast("Taslak hazır. Gözden geçirmeden kullanmayın; FredyMail göndermez.", "ok");
    } catch (e) {
      setError(aiError(e));
    } finally {
      setBusyDraft(false);
      refreshAi();
    }
  }

  // araç çubuğundan / kısayoldan tetikleme
  useEffect(() => {
    if (!p.trigger || !ai?.enabled) return;
    if (p.trigger.kind === "analyze" && !busy) analyze();
    if (p.trigger.kind === "draft" && !busyDraft) makeDraft();
    document.getElementById("intel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.trigger?.n]);

  async function saveTask(text: string, due: string | null, key?: string) {
    try {
      const t = await api.post<Task>("/api/tasks", { text, due, message_id: p.message.id, source: key ? "ai" : "user" });
      setTasks((l) => [t, ...l]);
      if (key) setSaved((s) => new Set(s).add(key));
      refreshCounts();
      toast("Yapılacaklara eklendi", "ok");
    } catch (e) {
      toast((e as ApiError).message, "error");
    }
  }

  async function toggleTask(t: Task) {
    try {
      const u = await api.patch<Task>(`/api/tasks/${t.id}`, { done: !t.done });
      setTasks((l) => l.map((x) => (x.id === u.id ? u : x)));
      refreshCounts();
    } catch (e) {
      toast((e as ApiError).message, "error");
    }
  }

  const results = [summary, actions, draft].filter(Boolean) as AiResult[];
  const allRefs = useMemo(() => {
    const by = new Map<number, AiRef>();
    for (const r of results) for (const x of r.references) if (!by.has(x.message_id)) by.set(x.message_id, x);
    return [...by.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, actions, draft]);
  const warnings = [...new Set(results.flatMap((r) => r.warnings))];
  const atts = p.messages.flatMap((m) => m.attachments.filter((a) => !a.is_inline).map((a) => ({ ...a, mid: m.id })));
  const analyzed = !!(summary || actions);
  const textTasks = new Set(tasks.map((t) => t.text.trim().toLocaleLowerCase("tr-TR")));
  const pending = (actions?.actions ?? []).map((a, i) => ({ ...a, key: `${i}:${a.task}` }))
    .filter((a) => !saved.has(a.key) && !textTasks.has(a.task.trim().toLocaleLowerCase("tr-TR")));

  const head = (
    <div className="intel-head">
      <Icon name="sparkle" size={22} className="intel-spark" />
      <h2>FredyMail Intelligence</h2>
      <span className="ai-badge">AI</span>
      {allRefs.length > 0 && (
        <button className="intel-src" onClick={() => setShowSources((v) => !v)} aria-expanded={showSources}>
          <Icon name="layers" size={16} />
          <span className="lbl">{allRefs.length} kaynağa göre analiz edildi</span>
          <span className="only-mobile">{allRefs.length}</span>
          <Icon name={showSources ? "up" : "down"} size={15} />
        </button>
      )}
    </div>
  );

  if (!ai) return null;
  if (!ai.enabled) {
    return (
      <section className="intel" id="intel" aria-label="FredyMail Intelligence">
        {head}
        <div className="intel-intro">
          <p>
            <strong>AI kapalı.</strong> Arama, okuma, etiket, not ve erteleme normal çalışır.{" "}
            {ai.configured ? "Ayarlar'dan tekrar açabilirsiniz." : "Bir AI sağlayıcısı yapılandırılmamış."}
          </p>
          <button className="btn sm" onClick={() => navigate({ page: "settings" })}>Ayarlar</button>
        </div>
      </section>
    );
  }

  const meta = results.map((r) => r.meta).filter(Boolean);

  return (
    <section className="intel" id="intel" aria-label="FredyMail Intelligence" aria-busy={busy || busyDraft}>
      {head}
      {!analyzed && (
        <div className="intel-intro">
          <p>
            {multi ? `Bu ${p.messages.length} mesajlık yazışmayı` : "Bu maili"} özetler, yapılacakları çıkarır ve yanıt taslağı hazırlar.
            Yalnızca siz bastığınızda çalışır; ekler gönderilmez, kişisel numaralar maskelenir.
          </p>
          <div className="row gap-sm">
            <button className="btn primary" onClick={() => analyze()} disabled={busy} data-testid="analyze">
              <Icon name="sparkle" size={16} /> {busy ? "Analiz ediliyor…" : "Analiz et"}
            </button>
          </div>
        </div>
      )}
      {error && <div className="intel-warn"><Banner kind="error">{error}</Banner></div>}
      {warnings.length > 0 && (
        <div className="intel-warn">
          <Banner kind="warn"><ul className="plain">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></Banner>
        </div>
      )}

      {(analyzed || busy || tasks.length > 0 || draft || busyDraft) && (
        <div className="intel-cols">
          <Col icon="note" title="Özet">
            {busy && !summary ? <Lines /> : summary ? (
              <>
                {summary.summary && <div className="intel-summary"><Cited text={summary.summary} refs={refMap(summary)} onOpen={p.onOpenMessage} /></div>}
                {summary.key_points && summary.key_points.length > 0 && (
                  <ul>
                    {summary.key_points.map((k, i) => (
                      <li key={i}><Cited text={k.text} refs={refMap(summary)} onOpen={p.onOpenMessage} /> <Sources ids={k.sources} refs={refMap(summary)} onOpen={p.onOpenMessage} /></li>
                    ))}
                  </ul>
                )}
              </>
            ) : <p className="muted small">“Analiz et” ile yazışmanın kısa özeti burada görünür.</p>}
          </Col>

          <Col icon="tasks" title="Yapılacaklar" extra={tasks.filter((t) => !t.done).length ? <span className="pill ok">{tasks.filter((t) => !t.done).length} açık</span> : null}>
            <div data-testid="intel-tasks">
              {tasks.map((t) => {
                const d = dueInfo(t.due);
                return (
                  <label key={t.id} className={`todo ${t.done ? "done" : ""}`}>
                    <input type="checkbox" checked={t.done} onChange={() => toggleTask(t)} aria-label={`${t.text} tamamlandı`} />
                    <span className="todo-text">{t.text}</span>
                    {d && !t.done && <span className={`due ${d.tone}`}>{d.label}</span>}
                  </label>
                );
              })}
              {busy && !actions && <Lines />}
              {pending.map((a) => {
                const due = parseDue(a.due);
                const d = dueInfo(due);
                return (
                  <div key={a.key} className="todo">
                    <button className="add" onClick={() => saveTask(a.task, due, a.key)} aria-label={`${a.task} — yapılacaklara ekle`} title="Yapılacaklara ekle" data-testid="save-task">
                      <Icon name="plus" size={15} />
                    </button>
                    <span className="todo-text"><Cited text={a.task} refs={refMap(actions)} onOpen={p.onOpenMessage} /> <Sources ids={a.sources} refs={refMap(actions)} onOpen={p.onOpenMessage} /></span>
                    {d ? <span className={`due ${d.tone}`}>{d.label}</span> : a.due ? <span className="due grey">{a.due}</span> : null}
                  </div>
                );
              })}
              {actions && !pending.length && !tasks.length && <p className="muted small">Bu yazışmada belirgin bir iş yok.</p>}
            </div>
            <form className="row gap-sm" onSubmit={(e) => { e.preventDefault(); if (newTask.trim()) { saveTask(newTask.trim(), null); setNewTask(""); } }}>
              <input value={newTask} onChange={(e) => setNewTask(e.target.value)} placeholder="Görev ekle…" aria-label="Yeni görev" />
              <button className="btn sm" disabled={!newTask.trim()}>Ekle</button>
            </form>
          </Col>

          <Col icon="edit" title="Yanıt taslağı">
            {busyDraft ? <div className="draft-box"><Spinner label="Taslak hazırlanıyor…" /></div> : draft ? (
              <>
                <div className="muted xs">Kime: {(draft.to ?? []).join(", ") || "—"} · {draft.subject}</div>
                <div className="draft-box" data-testid="draft-preview"><Cited text={draft.body ?? ""} refs={refMap(draft)} onOpen={p.onOpenMessage} /></div>
                <DraftActions to={draft.to ?? []} subject={draft.subject ?? ""} body={draft.body ?? ""} draftId={draft.draft_id} replyTo={p.message.id} compact />
              </>
            ) : (
              <div className="draft-box empty">Taslak yalnızca kaydedilir; FredyMail hiçbir maili göndermez.</div>
            )}
            <input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="İsteğiniz (ör. teşekkür et, teslim tarihini sor)" aria-label="Taslak isteği" />
            <button className="btn dark" onClick={() => makeDraft()} disabled={busyDraft} data-testid="make-draft">
              <Icon name="sparkle" size={15} /> {draft ? "Yeniden oluştur" : "Taslak oluştur"}
            </button>
          </Col>
        </div>
      )}

      {showSources && (allRefs.length > 0 || (analyzed && atts.length > 0)) && (
        <div className="sources-strip">
          <div className="sources-head"><Icon name="layers" size={16} /> Kaynaklar</div>
          <div className="src-cards">
            {allRefs.map((r) => (
              <button key={r.message_id} className="src-card" onClick={() => p.onOpenMessage(r.message_id)}>
                <span className="avatar sm" style={{ background: "var(--brand-soft)", color: "var(--brand-ink)" }}><Icon name="unread" size={15} /></span>
                <span className="grow">
                  <span className="t" style={{ display: "block" }}>{r.subject || "(konu yok)"}</span>
                  <span className="s" style={{ display: "block" }}>{r.from} · {fmtListDate(r.date)}</span>
                </span>
              </button>
            ))}
            {atts.map((a) => (
              <a key={`a-${a.id}`} className="src-card" href={`/api/messages/${a.mid}/attachments/${a.id}`} download={a.filename}>
                <FileIcon kind={a.file_kind} />
                <span className="grow">
                  <span className="t" style={{ display: "block" }}>{a.filename}</span>
                  <span className="s" style={{ display: "block" }}>{fmtSize(a.size)} · ek</span>
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {meta.length > 0 && (
        <div className="intel-meta" aria-label="AI çağrı ayrıntıları">
          {meta.some((m) => m?.cached) ? "Kısmen önbellekten · " : ""}
          {[...new Set(meta.map((m) => `${m?.model}${m?.tier === "heavy" ? " (güçlü)" : ""}`))].join(" + ")}
          {meta.some((m) => m?.escalated) && " · hafif modelin yanıtı kullanılamadı, güçlü modele geçildi"}
          {` · ${Math.max(...meta.map((m) => m?.messages_sent ?? 0))} mail, ${Math.max(...meta.map((m) => m?.chars_sent ?? 0)).toLocaleString("tr-TR")} karakter gönderildi`}
          {` · ~$${meta.reduce((s, m) => s + (m?.cost_usd ?? 0), 0).toFixed(4)}`}
          {meta.some((m) => m?.pii_redacted) && " · IBAN/kart/TCKN maskelendi"}
          {` · bugün ${ai.usage_today.calls}/${ai.limits.max_calls_per_day} çağrı`}
          {canUpgrade([summary, actions]) && (
            <button className="link-btn" onClick={() => analyze("best")} disabled={busy} data-testid="analyze-best">
              Güçlü modelle yeniden analiz et
            </button>
          )}
          {canUpgrade([draft]) && (
            <button className="link-btn" onClick={() => makeDraft("best")} disabled={busyDraft}>
              Taslağı güçlü modelle yeniden yaz
            </button>
          )}
        </div>
      )}
    </section>
  );
}

type Quality = "auto" | "fast" | "best";

/** Güçlü model tanımlıysa ve sonuçlardan biri hafif modelle üretildiyse yükseltme önerilir. */
export function canUpgrade(rs: (AiResult | null | undefined)[]): boolean {
  return rs.some((r) => r?.meta?.heavy_available && r.meta.tier !== "heavy");
}

function Col({ icon, title, extra, children }: { icon: string; title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <div className="intel-col">
      <div className="intel-col-head">
        <span className="ico"><Icon name={icon} size={16} /></span>
        <span className="grow">{title}</span>
        {extra}
      </div>
      {children}
    </div>
  );
}

function Lines() {
  return (
    <div className="sk-lines" aria-hidden="true">
      <div className="sk-line w90" /><div className="sk-line w60" /><div className="sk-line w90" /><div className="sk-line w40" />
    </div>
  );
}

/** Arama sonuçlarının AI özeti (modal içinde). */
export function SearchSummary({ search, onOpen }: { search: SearchState; onOpen: (id: number) => void }) {
  const [res, setRes] = useState<AiResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { refreshAi } = useStore();
  const run = (quality: Quality) => {
    const { q, smart: _s, sort: _o, ...rest } = search;
    void _s;
    void _o;
    const filters = Object.fromEntries(Object.entries(rest).filter(([k, v]) => v !== "" && !(k === "view" && (v === "all" || v === "folder"))));
    setRes(null);
    setError(null);
    api.post<AiResult>("/api/ai/search_summary", { query: q, filters, quality })
      .then(setRes)
      .catch((e) => setError(aiError(e)))
      .finally(refreshAi);
  };
  useEffect(() => {
    run("auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (error) return <Banner kind="error">{error}</Banner>;
  if (!res) return <Spinner label="Sonuçlar özetleniyor…" />;
  const refs = refMap(res);
  return (
    <div>
      {res.warnings.length > 0 && <Banner kind="warn">{res.warnings.join(" · ")}</Banner>}
      {res.summary && <p className="intel-summary"><Cited text={res.summary} refs={refs} onOpen={onOpen} /></p>}
      {res.key_points && (
        <ul>
          {res.key_points.map((k, i) => <li key={i}><Cited text={k.text} refs={refs} onOpen={onOpen} /> <Sources ids={k.sources} refs={refs} onOpen={onOpen} /></li>)}
        </ul>
      )}
      <div className="src-cards mt">
        {res.references.map((r) => (
          <button key={r.label} className="src-card" onClick={() => onOpen(r.message_id)}>
            <span className="src-chip">{r.label}</span>
            <span className="grow">
              <span className="t" style={{ display: "block" }}>{r.subject}</span>
              <span className="s" style={{ display: "block" }}>{r.from} · {fmtListDate(r.date)}</span>
            </span>
          </button>
        ))}
      </div>
      {canUpgrade([res]) && (
        <div className="intel-meta">
          {res.meta?.model} ile özetlendi ·{" "}
          <button className="link-btn" onClick={() => run("best")}>Güçlü modelle yeniden özetle</button>
        </div>
      )}
    </div>
  );
}
