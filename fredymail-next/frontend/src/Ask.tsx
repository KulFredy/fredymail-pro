import { useEffect, useRef, useState } from "react";
import { api, ApiError, qs } from "./api";
import { BarList, Legend, VolumeChart } from "./Charts";
import { openContextMenu, type MenuEvent } from "./contextmenu";
import { mailMenu } from "./mailmenu";
import { fromParams, goMail, navigate } from "./route";
import { useStore } from "./store";
import type { AskResult, MessageItem, SearchResult } from "./types";
import { ASK_SUGGESTIONS, avatarColor, daysLabel, daysTone, fmtListDate, fmtNum, initials } from "./util";
import { Banner, Empty, FileIcon, Highlight, Icon, Skeleton } from "./ui";

const FOLLOW_UPS: Record<string, string[]> = {
  top_senders: ["Hangi firmalarla en çok yazıştım bu yıl?", "Bu ay en çok kime mail attım?"],
  top_domains: ["Bu yıl en çok kimden mail aldım?", "Aylara göre mail dağılımı"],
  top_recipients: ["Bu yıl en çok kimden mail aldım?", "Yanıt beklediğim yazışmalar"],
  volume: ["Bu hafta kaç mail geldi?", "Bu yıl en çok kimden mail aldım?"],
  count: ["Aylara göre mail dağılımı", "Son 30 gün cevaplanmamış mailler"],
  search: ["Bu ay en çok kimden mail aldım?", "Yanıt beklediğim yazışmalar"],
  followups: ["Bu hafta kaç mail geldi?", "Hangi firmalarla en çok yazıştım bu yıl?"],
};

export function AskPage({ q }: { q: string }) {
  const [text, setText] = useState(q);
  const [res, setRes] = useState<AskResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [extra, setExtra] = useState<MessageItem[]>([]);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const { ai, toast, tags, meta, openComposer, refreshFolders, refreshTags, refreshCounts } = useStore();
  const rowMenu = (e: MenuEvent, m: MessageItem) => openContextMenu(e, mailMenu(m, {
    open: () => goMail({ view: "all", ...fromParams(params) }, m.id), toast, tags, me: meta?.account ? [meta.account] : [],
    aiEnabled: !!ai?.enabled, openComposer, refreshFolders, refreshTags, refreshCounts,
    onUpdated: (u) => setExtra((l) => l.map((x) => (x.id === u.id ? { ...x, ...u } : x))),
  }));
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText(q);
    if (!q) {
      setRes(null);
      ref.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    setExtra([]);
    setPage(1);
    api.post<AskResult>("/api/ask", { question: q, allow_ai: !!ai?.enabled })
      .then(setRes)
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const ask = (s: string) => s.trim() && navigate({ page: "ask", q: s.trim() });
  const params = res?.params ?? {};
  const openList = (extra: Record<string, string> = {}) => goMail({ view: "all", ...fromParams(params, extra) });
  const stats = res?.stats;
  const results = res?.search ? [...res.search.items, ...extra] : [];
  const kinds = String(params.file_kind ?? "").split(",").filter(Boolean);
  async function loadMore() {
    setLoadingMore(true);
    try {
      const r = await api.get<SearchResult>(`/api/search${qs({ ...params, page: page + 1, per_page: 50 })}`);
      setExtra((l) => [...l, ...r.items]);
      setPage(page + 1);
    } catch (e) {
      toast((e as ApiError).message, "error");
    } finally {
      setLoadingMore(false);
    }
  }
  const more = res ? FOLLOW_UPS[res.mode === "stats" ? res.stat ?? "count" : res.mode] ?? [] : [];

  return (
    <main className="page" aria-label="Asistana sor">
      <div className="page-inner narrow">
        <div className="page-head">
          <div>
            <h1><Icon name="sparkle" size={26} className="intel-spark" /> Asistana sor</h1>
            <p className="lead">Postalarınıza doğal dille soru sorun. Yanıtlar sayımlardan gelir; mail içeriği yalnızca AI açıksa ve gerekirse kullanılır.</p>
          </div>
        </div>
        <form className="ask-page-form" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
          <input ref={ref} value={text} onChange={(e) => setText(e.target.value)} placeholder="ör. bu yıl en çok kimden mail aldım?" aria-label="Soru" />
          <button className="btn primary lg" disabled={!text.trim() || busy}><Icon name="sparkle" size={17} /> Sor</button>
        </form>

        {!q && (
          <section className="card">
            <div className="card-head"><h2>Şunları deneyebilirsiniz</h2></div>
            <div className="row gap-sm wrap">
              {ASK_SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => ask(s)}>{s}</button>)}
            </div>
          </section>
        )}

        {busy && <div className="card"><Skeleton rows={4} /></div>}
        {error && <Banner kind="error">{error}</Banner>}

        {res && !busy && (
          <div data-testid="ask-result" style={{ animation: "fadeUp .25s" }}>
            <div className="understood">
              <span className="lbl">Anladığım:</span>
              {res.understood.map((u) => <span key={u} className="u-chip">{u}</span>)}
              {!res.understood.length && <span className="u-chip">Genel arama</span>}
              <span className="engine" title={res.engine === "ai" ? "Soru AI ile yorumlandı" : "Soru kurallarla yorumlandı (AI kullanılmadı)"}>
                {res.engine === "ai" ? "✦ AI" : "Kurallı"}
              </span>
            </div>

            {res.mode === "stats" && stats && (
              <section className="card">
                <div className="card-head">
                  <div>
                    <h2>{stats.title}</h2>
                    <div className="sub">{res.period_label}{stats.note ? ` · ${stats.note}` : ""}</div>
                  </div>
                  {stats.volume && <Legend />}
                </div>
                {stats.rows && (
                  <BarList testId="ask-table" empty="Bu dönemde kayıt yok" items={stats.rows.map((r) => ({
                    key: r.label + r.sublabel, label: r.label, sub: r.sublabel && r.sublabel !== r.label ? r.sublabel : undefined, value: r.count,
                    onClick: () => openList(r.filter),
                  }))} />
                )}
                {stats.volume && <VolumeChart volume={stats.volume} />}
                {stats.total !== undefined && (
                  <div className="totals">
                    <button className="total-box kpi" onClick={() => openList()}><span className="kpi-lbl">Toplam</span><b>{fmtNum(stats.total)}</b></button>
                    <div className="total-box"><span className="kpi-lbl">Gelen</span><b>{fmtNum(stats.received)}</b></div>
                    <div className="total-box"><span className="kpi-lbl">Gönderilen</span><b>{fmtNum(stats.sent)}</b></div>
                  </div>
                )}
              </section>
            )}

            {res.mode === "search" && res.search && (
              <section className="card">
                <div className="card-head">
                  <div><h2>{fmtNum(res.search.total)} mail bulundu</h2><div className="sub">{res.period_label}</div></div>
                  <button className="btn sm soft" onClick={() => openList()}>Listede aç <Icon name="chevron" size={15} /></button>
                </div>
                {!res.search.items.length && <Empty art="search" title="Sonuç yok">Soruyu farklı kelimelerle deneyin.</Empty>}
                <div className="compact-list">
                  {results.map((m) => (
                    <div key={m.id} className={`mrow ${m.is_read ? "" : "unread"}`} role="button" tabIndex={0}
                      onContextMenu={(e) => rowMenu(e, m)}
                      onClick={() => goMail({ view: "all", ...fromParams(params) }, m.id)}
                      onKeyDown={(e) => e.key === "Enter" && goMail({ view: "all", ...fromParams(params) }, m.id)}>
                      <span className="avatar" style={{ background: avatarColor(m.from_email) }}>{initials(m.from_name, m.from_email)}</span>
                      <div className="r-main">
                        <span className="r-from ellipsis">{m.from_name || m.from_email}</span>
                        <span className="r-subject ellipsis"><Highlight text={m.highlight.subject} fallback={m.subject} /></span>
                        {m.attachments.length > 0 && (
                          <span className="r-atts">
                            {m.attachments.filter((a) => !kinds.length || kinds.includes(a.file_kind)).slice(0, 3).map((a) => (
                              <span key={a.id} className="att-chip" title={a.filename}><FileIcon kind={a.file_kind} /> {a.filename}</span>
                            ))}
                          </span>
                        )}
                      </div>
                      <div className="r-side"><span className="r-date">{fmtListDate(m.date)}</span>{m.has_attachments && <Icon name="clip" size={14} className="faint" />}</div>
                    </div>
                  ))}
                </div>
                {results.length < res.search.total && (
                  <div className="list-foot">
                    <button className="btn" onClick={loadMore} disabled={loadingMore} data-testid="ask-more">
                      {loadingMore ? "Yükleniyor…" : `Daha fazla göster (${fmtNum(results.length)} / ${fmtNum(res.search.total)})`}
                    </button>
                  </div>
                )}
              </section>
            )}

            {res.mode === "followups" && (
              <section className="card">
                <div className="card-head">
                  <div><h2>{res.followup_kind === "awaiting" ? "Yanıt beklediğim yazışmalar" : "Yanıtlamam gerekenler"}</h2><div className="sub">{res.followups?.length ?? 0} yazışma</div></div>
                  <button className="btn sm soft" onClick={() => navigate({ page: "followups", kind: res.followup_kind ?? "needs_reply", msg: null })}>Bekleyenlerde aç <Icon name="chevron" size={15} /></button>
                </div>
                <div className="compact-list">
                  {(res.followups ?? []).map((f) => (
                    <div key={f.thread_id} className="mrow" role="button" tabIndex={0}
                      onClick={() => navigate({ page: "followups", kind: res.followup_kind ?? "needs_reply", msg: f.last_message.id })}>
                      <span className="avatar" style={{ background: avatarColor(f.last_message.from_email) }}>{initials(f.last_message.from_name, f.last_message.from_email)}</span>
                      <div className="r-main">
                        <span className="r-from ellipsis">{f.last_message.from_name || f.last_message.from_email}</span>
                        <span className="r-subject ellipsis">{f.subject}</span>
                      </div>
                      <div className="r-side"><span className={`days ${daysTone(f.days_waiting)}`} style={{ height: 26 }}>{daysLabel(f.days_waiting)}</span></div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {more.length > 0 && (
              <div className="mt">
                <div className="muted small" style={{ marginBottom: 8, fontWeight: 650 }}>Şunu da sorabilirsiniz</div>
                <div className="row gap-sm wrap">
                  {more.map((s) => <button key={s} className="chip" onClick={() => ask(s)}><Icon name="sparkle" size={13} /> {s}</button>)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
