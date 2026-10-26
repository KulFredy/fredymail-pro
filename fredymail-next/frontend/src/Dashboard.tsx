import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { BarList, Legend, VolumeChart } from "./Charts";
import { goMail, navigate, type SearchState } from "./route";
import { useStore } from "./store";
import type { Insights } from "./types";
import { addDays, ASK_SUGGESTIONS, fmtNum, greeting } from "./util";
import { Banner, Icon } from "./ui";

const PERIODS: [string, string][] = [
  ["today", "Bugün"],
  ["this_week", "Bu hafta"],
  ["this_month", "Bu ay"],
  ["last_30_days", "Son 30 gün"],
  ["this_year", "Bu yıl"],
  ["all", "Tüm zamanlar"],
];

export function Dashboard({ period }: { period: string }) {
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const { meta } = useStore();

  useEffect(() => {
    setError(null);
    api.get<Insights>(`/api/insights?period=${period}`).then(setData).catch((e: ApiError) => setError(e.message));
  }, [period]);

  // dönem aralığını liste filtresine çevir (to = hariç sınır)
  const range = (): Partial<SearchState> => {
    if (!data) return {};
    const out: Partial<SearchState> = {};
    if (data.from) out.date_from = data.from.slice(0, 10);
    if (data.to) {
      const d = new Date(data.to);
      d.setUTCDate(d.getUTCDate() - 1);
      out.date_to = d.toISOString().slice(0, 10);
    }
    return out;
  };
  const drill = (patch: Partial<SearchState>) => goMail({ view: "all", ...range(), ...patch });
  const c = data?.counts;
  const name = (meta?.account ?? "").split("@")[0];
  const docs = Object.entries(c?.doc_kinds ?? {}).sort((a, b) => b[1] - a[1]);

  const kpis = c ? [
    { key: "in", label: "Gelen", value: c.received, icon: "inbox", tone: "t-green", go: () => drill({ view: "all", direction: "in" }) },
    { key: "out", label: "Gönderilen", value: c.sent, icon: "sent", tone: "t-blue", go: () => drill({ view: "sent" }) },
    { key: "unread", label: "Okunmamış", value: c.unread, icon: "unread", tone: "t-amber", go: () => drill({ view: "unread" }) },
    { key: "needs", label: "Yanıtlamam gereken", value: c.needs_reply, icon: "reply", tone: "t-red", go: () => navigate({ page: "followups", kind: "needs_reply", msg: null }) },
    { key: "await", label: "Yanıt beklediğim", value: c.awaiting, icon: "hourglass", tone: "t-violet", go: () => navigate({ page: "followups", kind: "awaiting", msg: null }) },
    { key: "inv", label: "Fatura", value: c.doc_kinds.invoice ?? 0, icon: "receipt", tone: "t-cyan", go: () => drill({ doc_kind: "invoice" }) },
  ] : [];

  return (
    <main className="page" aria-label="Pano">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <div className="greet">{greeting()}{name ? `, ${name}` : ""} 👋</div>
            <h1>Pano</h1>
            <p className="lead">Posta kutunuzun özeti — bir sayıya veya isme tıklayınca ilgili maillere gidersiniz.</p>
          </div>
        </div>

        <div className="chip-row" role="group" aria-label="Dönem" style={{ marginBottom: 18 }}>
          {PERIODS.map(([k, label]) => (
            <button key={k} className={`chip solid ${period === k ? "on" : ""}`} onClick={() => navigate({ page: "dashboard", period: k }, true)} aria-pressed={period === k}>
              {label}
            </button>
          ))}
        </div>

        {error && <Banner kind="error">{error}</Banner>}

        <div className="kpis" data-testid="kpis">
          {!c && Array.from({ length: 6 }).map((_, i) => <div key={i} className="sk-block" style={{ height: 122 }} />)}
          {kpis.map((k) => (
            <button key={k.key} className={`kpi ${k.tone}`} onClick={k.go}>
              <span className="kpi-top">
                <span className="kpi-ico"><Icon name={k.icon} size={19} /></span>
                <Icon name="chevron" size={16} className="faint" />
              </span>
              <span className="kpi-val">{fmtNum(k.value)}</span>
              <span className="kpi-lbl">{k.label}</span>
            </button>
          ))}
        </div>

        <div className="dash-grid">
          <section className="card">
            <div className="card-head">
              <div>
                <h2>Mail trafiği</h2>
                <div className="sub">{data?.label ?? "…"} · {data?.volume.unit === "day" ? "günlük" : "aylık"}</div>
              </div>
              <Legend />
            </div>
            <div data-testid="volume-chart">
              {data ? <VolumeChart volume={data.volume} /> : <div className="sk-block" style={{ height: 230 }} />}
            </div>
          </section>

          <section className="card ask-card">
            <h2><Icon name="sparkle" size={20} /> Asistana sor</h2>
            <p>Doğal dille sorun: kimden, ne zaman, kaç tane, hangi belge… Kurallı motor anında yanıtlar; gerekirse AI devreye girer.</p>
            <form className="ask-form" onSubmit={(e) => { e.preventDefault(); if (q.trim()) navigate({ page: "ask", q: q.trim() }); }}>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ör. bu yıl en çok kimden mail aldım?" aria-label="Soru" />
              <button className="btn primary" disabled={!q.trim()}><Icon name="sparkle" size={16} /> Sor</button>
            </form>
            <div className="ask-sugs">
              {ASK_SUGGESTIONS.slice(0, 4).map((s) => (
                <button key={s} className="ask-sug" onClick={() => navigate({ page: "ask", q: s })}>{s}</button>
              ))}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <div><h2>En çok yazanlar</h2><div className="sub">Kişiler · bültenler hariç</div></div>
              <Icon name="user" className="faint" />
            </div>
            {data ? (
              <BarList testId="top-senders" items={data.top_senders.map((r) => ({ key: r.email ?? r.name, label: r.name, sub: r.email !== r.name ? r.email : undefined, value: r.count, onClick: () => drill({ sender: r.filter.sender }) }))} />
            ) : <div className="sk-block" style={{ height: 200 }} />}
          </section>

          <section className="card">
            <div className="card-head">
              <div><h2>En çok yazışılan firmalar</h2><div className="sub">Alan adına göre</div></div>
              <Icon name="building" className="faint" />
            </div>
            {data ? (
              <BarList items={data.top_domains.map((r) => ({ key: r.domain ?? r.name, label: r.name, value: r.count, onClick: () => drill({ sender: r.filter.sender }) }))} />
            ) : <div className="sk-block" style={{ height: 200 }} />}
          </section>

          <section className="card">
            <div className="card-head">
              <div><h2>Belgeler</h2><div className="sub">Maillerde tanınan belge türleri</div></div>
              <Icon name="receipt" className="faint" />
            </div>
            {data ? (
              <BarList empty="Bu dönemde belge tanınmadı" items={docs.map(([k, v]) => ({ key: k, label: meta?.doc_kinds[k] ?? k, value: v, onClick: () => drill({ doc_kind: k }) }))} />
            ) : <div className="sk-block" style={{ height: 160 }} />}
          </section>

          <section className="card">
            <div className="card-head">
              <div><h2>Ekler</h2><div className="sub">{fmtNum(c?.with_attachments)} ekli mail</div></div>
              <Icon name="clip" className="faint" />
            </div>
            {data ? (
              <BarList empty="Bu dönemde ek yok" items={Object.entries(c?.file_kinds ?? {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ key: k, label: meta?.file_kinds[k] ?? k, value: v, onClick: () => drill({ file_kind: k }) }))} />
            ) : <div className="sk-block" style={{ height: 160 }} />}
            <div className="row gap-sm wrap mt">
              <button className="btn sm ghost" onClick={() => goMail({ view: "all", date_from: addDays(-7) })}><Icon name="calendar" size={15} /> Son 7 günün mailleri</button>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
