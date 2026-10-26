import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { EMPTY_SEARCH, navigate } from "./route";
import { useStore } from "./store";
import type { Task } from "./types";
import { addDays, dueInfo, todayKey } from "./util";
import { Banner, Empty, Icon, Skeleton } from "./ui";

const GROUPS: [string, string][] = [
  ["overdue", "Gecikmiş"],
  ["today", "Bugün"],
  ["tomorrow", "Yarın"],
  ["week", "Bu hafta"],
  ["later", "Sonra"],
  ["none", "Tarihsiz"],
  ["done", "Tamamlananlar"],
];

function groupOf(t: Task): string {
  if (t.done) return "done";
  if (!t.due) return "none";
  const today = todayKey();
  if (t.due < today) return "overdue";
  if (t.due === today) return "today";
  if (t.due === addDays(1)) return "tomorrow";
  if (t.due <= addDays(7)) return "week";
  return "later";
}

export function TasksPage() {
  const [list, setList] = useState<Task[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  const { toast, refreshCounts } = useStore();

  const load = useCallback(() => {
    setError(null);
    api.get<Task[]>(`/api/tasks${showDone ? "?include_done=true" : ""}`).then(setList).catch((e: ApiError) => setError(e.message));
  }, [showDone]);
  useEffect(load, [load]);

  async function run<T>(p: Promise<T>, after: (v: T) => void) {
    try {
      after(await p);
      refreshCounts();
    } catch (e) {
      toast((e as ApiError).message, "error");
    }
  }
  const upd = (u: Task) => setList((l) => (l ?? []).map((x) => (x.id === u.id ? u : x)).filter((x) => showDone || !x.done));

  const groups = GROUPS.map(([k, label]) => ({ k, label, items: (list ?? []).filter((t) => groupOf(t) === k) })).filter((g) => g.items.length);
  const open = (list ?? []).filter((t) => !t.done).length;

  return (
    <main className="page" aria-label="Yapılacaklar">
      <div className="page-inner narrow">
        <div className="page-head">
          <div>
            <h1>Yapılacaklar</h1>
            <p className="lead">Maillerden çıkan işler. AI önerilerini veya kendi notlarınızı buraya kaydedin; kaynak maile tek tıkla dönün.</p>
          </div>
          <span className="count-badge"><Icon name="tasks" size={15} /> {list ? open : "…"} açık</span>
        </div>

        <form className="task-new" onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          run(api.post<Task>("/api/tasks", { text: text.trim(), due: due || null }), (t) => { setList((l) => [t, ...(l ?? [])]); setText(""); setDue(""); });
        }}>
          <input type="text" className="grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="Yeni görev… (ör. Ege Lojistik'e navlun teklifini sor)" aria-label="Yeni görev" />
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Son tarih" />
          <button className="btn primary lg" disabled={!text.trim()}><Icon name="plus" size={16} /> Ekle</button>
        </form>

        <div className="row between" style={{ marginBottom: 12 }}>
          <span className="muted small">{list ? `${list.length} görev` : ""}</span>
          <label className="check small">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Tamamlananları göster
          </label>
        </div>

        {error && <Banner kind="error">{error} <button className="link" onClick={load}>Tekrar dene</button></Banner>}
        {!list && !error && <div className="task-list"><Skeleton rows={4} /></div>}
        {list && !groups.length && (
          <div className="card"><Empty art="done" title="Yapılacak iş yok">Bir mailde “Analiz et” ile önerilen işleri buraya ekleyebilirsiniz.</Empty></div>
        )}
        <div data-testid="task-groups">
          {groups.map((g) => (
            <section key={g.k} className="task-group">
              <h3 className={g.k === "overdue" ? "red" : ""}>{g.label} <span className="faint">{g.items.length}</span></h3>
              <div className="task-list">
                {g.items.map((t) => {
                  const d = dueInfo(t.due);
                  return (
                    <div key={t.id} className={`task ${t.done ? "done" : ""}`}>
                      <input type="checkbox" checked={t.done} aria-label={`${t.text} tamamlandı`}
                        onChange={() => run(api.patch<Task>(`/api/tasks/${t.id}`, { done: !t.done }), upd)} />
                      <div className="grow">
                        <div className="t-text">{t.text}</div>
                        <div className="t-sub">
                          {t.source === "ai" && <span className="pill ai"><Icon name="sparkle" size={11} /> AI</span>}
                          {d && !t.done && <span className={`due ${d.tone}`}>{d.label}</span>}
                          {t.message_id && (
                            <button className="link small" onClick={() => navigate({ page: "mail", search: { ...EMPTY_SEARCH, view: "all" }, msg: t.message_id })}>
                              <Icon name="unread" size={13} className="faint" /> Kaynak mail
                            </button>
                          )}
                        </div>
                      </div>
                      <input type="date" value={t.due ?? ""} aria-label="Son tarihi değiştir" className="hide-mobile"
                        onChange={(e) => run(api.patch<Task>(`/api/tasks/${t.id}`, e.target.value ? { due: e.target.value } : { clear_due: true }), upd)} />
                      <button className="icon-btn sm" aria-label="Görevi sil" title="Sil"
                        onClick={() => window.confirm("Görev silinsin mi?") && run(api.del(`/api/tasks/${t.id}`), () => setList((l) => (l ?? []).filter((x) => x.id !== t.id)))}>
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
