import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { keyMenuEvent, openContextMenu, type MenuEvent } from "./contextmenu";
import { aiError, canUpgrade, Cited } from "./Intel";
import { mailMenu } from "./mailmenu";
import { Reader, replySubject, replyTarget } from "./Reader";
import { EMPTY_SEARCH, navigate, type FollowKind } from "./route";
import { useStore } from "./store";
import type { AiResult, FollowupItem } from "./types";
import { avatarColor, daysLabel, daysTone, domainOf, initials, parseDue, readPref, writePref } from "./util";
import { Banner, Empty, Icon, Skeleton, Spinner } from "./ui";

type Range = "all" | "today" | "week";
type Scope = "external" | "team";
interface FollowupResp { days: number; window_days: number; has_team: boolean; total: number; totals: Record<Scope, number>; items: FollowupItem[] }

export function FollowupsPage({ kind, msg }: { kind: FollowKind; msg: number | null }) {
  const [items, setItems] = useState<FollowupItem[] | null>(null);
  const [days, setDays] = useState(0);
  const [info, setInfo] = useState<FollowupResp | null>(null);
  const [scope, setScopeState] = useState<Scope>(() => (readPref("fm.fu.scope") === "team" ? "team" : "external"));
  const setScope = (s: Scope) => {
    writePref("fm.fu.scope", s);
    setScopeState(s);
  };
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>("all");
  const [open, setOpen] = useState<number | null>(null);
  const { counts, refreshCounts } = useStore();

  const load = useCallback(() => {
    setError(null);
    setItems(null);
    api.get<FollowupResp>(`/api/followups?kind=${kind}&scope=${scope}`)
      .then((r) => {
        setDays(r.days);
        setInfo(r);
        setItems(r.items);
      })
      .catch((e: ApiError) => setError(e.message));
  }, [kind, scope]);
  useEffect(load, [load]);

  const remove = (tid: number) => {
    setItems((l) => l?.filter((x) => x.thread_id !== tid) ?? null);
    refreshCounts();
  };

  if (msg) {
    const sel = items?.find((i) => i.last_message.id === msg);
    return (
      <div className="followup-reader">
        <div className="back-bar hide-mobile">
          <button className="link" onClick={() => navigate({ page: "followups", kind, msg: null })}>← Yanıt Bekleyenler</button>
        </div>
        <Reader
          key={msg}
          msgId={msg}
          followupThreadId={sel?.thread_id ?? null}
          onBack={() => navigate({ page: "followups", kind, msg: null })}
          onChanged={() => undefined}
          onOpenMessage={(id) => navigate({ page: "mail", search: { ...EMPTY_SEARCH, view: "all" }, msg: id })}
          onDismissed={() => {
            if (sel) remove(sel.thread_id);
            navigate({ page: "followups", kind, msg: null });
          }}
        />
      </div>
    );
  }

  const shown = (items ?? []).filter((f) => {
    if (range === "today") return (f.days_waiting ?? 99) <= 0;
    if (range === "week") return (f.days_waiting ?? 99) <= 7;
    return true;
  });
  const needs = kind === "needs_reply";

  return (
    <main className="page" aria-label="Yanıt bekleyenler">
      <div className="page-inner narrow">
        <div className="page-head">
          <div>
            <h1>Yanıt Bekleyenler</h1>
            <p className="lead">
              {needs
                ? `Size “Kime” ile yazılmış, ${days}–${info?.window_days ?? 30} gündür yanıtlamadığınız yazışmalar. Cc'de olduklarınız, bültenler, otomatik raporlar ve Outlook'ta yanıtlananlar hariç.`
                : `Sizin yazdığınız, ${days}–${info?.window_days ?? 45} gündür karşı tarafın yanıt vermediği yazışmalar.`}
            </p>
          </div>
          <span className="count-badge"><Icon name="sparkle" size={15} /> {items ? shown.length : "…"} öğe</span>
        </div>

        <div className="row gap wrap" style={{ marginBottom: 16 }}>
          <div className="seg" role="tablist" aria-label="Tür">
            <button role="tab" aria-selected={needs} className={needs ? "on" : ""} onClick={() => navigate({ page: "followups", kind: "needs_reply", msg: null })}>
              Yanıtlamam gereken {counts.needs_reply > 0 && <span className="badge">{counts.needs_reply}</span>}
            </button>
            <button role="tab" aria-selected={!needs} className={!needs ? "on" : ""} onClick={() => navigate({ page: "followups", kind: "awaiting", msg: null })}>
              Yanıt beklediğim {counts.awaiting > 0 && <span className="badge">{counts.awaiting}</span>}
            </button>
          </div>
          {info?.has_team && (
            <div className="seg" role="tablist" aria-label="Kimden">
              <button role="tab" aria-selected={scope === "external"} className={scope === "external" ? "on" : ""} onClick={() => setScope("external")} data-testid="scope-external">
                Müşteri &amp; tedarikçi <span className="badge">{info.totals.external}</span>
              </button>
              <button role="tab" aria-selected={scope === "team"} className={scope === "team" ? "on" : ""} onClick={() => setScope("team")} data-testid="scope-team">
                Ekip içi <span className="badge">{info.totals.team}</span>
              </button>
            </div>
          )}
          <div className="chip-row" role="group" aria-label="Zaman">
            {([["all", "Tümü"], ["today", "Bugün"], ["week", "Bu hafta"]] as [Range, string][]).map(([k, l]) => (
              <button key={k} className={`chip solid ${range === k ? "on" : ""}`} onClick={() => setRange(k)}>{l}</button>
            ))}
          </div>
        </div>

        {error && <Banner kind="error">{error} <button className="link" onClick={load}>Tekrar dene</button></Banner>}
        {!items && !error && <div className="card"><Skeleton rows={4} /></div>}
        {items && !shown.length && (
          <div className="card">
            <Empty art="done" title={needs ? "Bekleyen yanıt yok" : "Yanıt beklenen yazışma yok"}>
              {range !== "all" ? "Bu aralıkta öğe yok; “Tümü”ne bakın." : "Harika — takip edilecek bir şey kalmadı."}
            </Empty>
          </div>
        )}
        <div className="fu-list" data-testid="followups">
          {shown.map((f) => (
            <FollowCard key={f.thread_id} f={f} kind={kind} open={open === f.thread_id}
              onToggle={() => setOpen(open === f.thread_id ? null : f.thread_id)}
              onDismissed={() => remove(f.thread_id)} onMuted={() => { load(); refreshCounts(); }} />
          ))}
        </div>
      </div>
    </main>
  );
}

function FollowCard({ f, kind, open, onToggle, onDismissed, onMuted }: { f: FollowupItem; kind: FollowKind; open: boolean; onToggle: () => void; onDismissed: () => void; onMuted: () => void }) {
  const m = f.last_message;
  const other = m.is_from_me ? m.to[0] ?? { email: m.from_email, name: m.from_name } : { email: m.from_email, name: m.from_name };
  const company = [other.name, domainOf(other.email)].filter(Boolean).join(" · ");
  const { ai, toast, refreshCounts, refreshAi, openComposer, meta, tags, refreshFolders, refreshTags } = useStore();
  const menu = (e: MenuEvent) => openContextMenu(e, mailMenu(m, {
    open: () => navigate({ page: "followups", kind, msg: m.id }), toast, tags, me: meta?.account ? [meta.account] : [],
    aiEnabled: !!ai?.enabled, openComposer, refreshFolders, refreshTags, refreshCounts,
    extra: [
      ...(ai?.enabled ? [{ label: "Takip önerisi al", icon: "bulb", onClick: () => { if (!open) onToggle(); suggest(); } }] : []),
      { label: "Takibi kapat", icon: "check", onClick: dismiss },
    ],
  }));
  const [sug, setSug] = useState<AiResult | null>(null);
  const [busy, setBusy] = useState<"" | "sug" | "draft">("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<number>>(new Set());

  async function suggest(quality: "auto" | "best" = "auto") {
    setBusy("sug");
    setError(null);
    try {
      setSug(await api.post<AiResult>("/api/ai/followup", { message_id: m.id, thread_id: f.thread_id, quality }));
    } catch (e) {
      setError(aiError(e));
    } finally {
      setBusy("");
      refreshAi();
    }
  }

  async function draft() {
    setBusy("draft");
    setError(null);
    try {
      const out = await api.post<AiResult>("/api/ai/draft", {
        message_id: m.id, thread_id: f.thread_id,
        instruction: kind === "awaiting" ? "Kibar bir hatırlatma / takip maili yaz" : "Kısa ve net bir yanıt yaz",
      });
      refreshCounts();
      openComposer({ to: out.to ?? [], subject: out.subject ?? "", body: out.body ?? "", draftId: out.draft_id, replyToMessageId: m.id, source: "ai" });
    } catch (e) {
      setError(aiError(e));
    } finally {
      setBusy("");
      refreshAi();
    }
  }

  async function saveAction(i: number, task: string, due: string | null | undefined) {
    try {
      await api.post("/api/tasks", { text: task, due: parseDue(due), message_id: m.id, source: "ai" });
      setSaved((s) => new Set(s).add(i));
      refreshCounts();
      toast("Yapılacaklara eklendi", "ok");
    } catch (e) {
      toast((e as ApiError).message, "error");
    }
  }

  async function dismiss() {
    try {
      await api.post(`/api/threads/${f.thread_id}/dismiss-followup`);
      toast("Takip kapatıldı", "ok");
      onDismissed();
    } catch (e) {
      toast((e as ApiError).message, "error");
    }
  }

  async function mute() {
    const email = m.from_email;
    if (!window.confirm(`${email} adresinden gelen mailler takip listelerinde artık gösterilmesin mi?\n(Mailler silinmez; Ayarlar'dan geri alabilirsiniz.)`)) return;
    try {
      await api.post("/api/followups/muted", { email, muted: true });
      toast(`${email} takip listelerinden çıkarıldı`, "ok");
      onMuted();
    } catch (e) {
      toast((e as ApiError).message, "error");
    }
  }

  function blank() {
    const me = meta?.account ? [meta.account] : [];
    openComposer({ to: replyTarget(m, me), subject: replySubject(f.subject), body: "", replyToMessageId: m.id });
  }

  const refs = new Map((sug?.references ?? []).map((r) => [r.label, r]));
  const tone = daysTone(f.days_waiting);

  return (
    <article className={`fu-card ${open ? "open" : ""}`} onContextMenu={menu}
      onKeyDown={(e) => { const k = keyMenuEvent(e); if (k) menu(k); }}>
      <button className="fu-main" onClick={onToggle} aria-expanded={open}>
        <span className="avatar" style={{ background: avatarColor(other.email) }} aria-hidden="true">{initials(other.name ?? "", other.email)}</span>
        <span style={{ minWidth: 0 }}>
          <span className="fu-co" style={{ display: "block" }}>{company.toLocaleUpperCase("tr-TR")}</span>
          <span className="fu-title" style={{ display: "block" }}>{f.subject}</span>
          <span className="fu-snip" style={{ display: "block" }}>{m.snippet}</span>
        </span>
        <span className={`days ${tone}`} title={kind === "awaiting" ? "Yanıt gelmeyen süre" : "Bekleme süresi"}>
          <Icon name="clock" size={14} /> {daysLabel(f.days_waiting)}
        </span>
        <Icon name="chevron" size={18} className="fu-chev" />
      </button>
      {open && (
        <div className="fu-body">
          <div className="suggest" data-testid="followup-suggest">
            <div className="suggest-head"><Icon name="sparkle" size={18} /> Takip önerisi</div>
            {!sug && busy !== "sug" && (
              <>
                <p className="muted">{kind === "awaiting" ? "Karşı taraf yanıt vermedi." : "Bu yazışma yanıtınızı bekliyor."} {f.message_count} mesaj · son mail {other.name || other.email}.</p>
                {ai?.enabled ? (
                  <button className="btn primary" onClick={() => suggest()} data-testid="get-suggestion"><Icon name="sparkle" size={15} /> Takip önerisi al</button>
                ) : <p className="muted small">AI kapalı — önerileri Ayarlar'dan açabilirsiniz.</p>}
              </>
            )}
            {busy === "sug" && <Spinner label="Öneri hazırlanıyor…" />}
            {sug && (
              <>
                {sug.suggestion && <p><Cited text={sug.suggestion} refs={refs} onOpen={(id) => navigate({ page: "followups", kind, msg: id })} /></p>}
                {sug.warnings.length > 0 && <Banner kind="warn">{sug.warnings.join(" · ")}</Banner>}
                {(sug.actions ?? []).length > 0 && (
                  <div className="suggest-actions">
                    {(sug.actions ?? []).map((a, i) => (
                      <button key={i} className={`act-chip ${saved.has(i) ? "saved" : ""}`} onClick={() => !saved.has(i) && saveAction(i, a.task, a.due)} disabled={saved.has(i)}
                        title={saved.has(i) ? "Yapılacaklara eklendi" : "Yapılacaklara ekle"}>
                        <Icon name={saved.has(i) ? "check" : "plus"} size={16} /> {a.task.replace(/\s*\[M\d+\]/g, "")}
                      </button>
                    ))}
                  </div>
                )}
                {canUpgrade([sug]) && (
                  <button className="link-btn" onClick={() => suggest("best")} disabled={busy !== ""}>Güçlü modelle yeniden dene</button>
                )}
              </>
            )}
            {error && <Banner kind="error">{error}</Banner>}
            <div className="fu-foot">
              {ai?.enabled && (
                <button className="btn dark" onClick={draft} disabled={busy !== ""} data-testid="followup-draft">
                  <Icon name="edit" size={15} /> {busy === "draft" ? "Hazırlanıyor…" : "Taslak hazırla →"}
                </button>
              )}
              {!ai?.enabled && <button className="btn" onClick={blank}><Icon name="edit" size={15} /> Yanıt yaz</button>}
              <button className="btn" onClick={() => navigate({ page: "followups", kind, msg: m.id })}><Icon name="unread" size={15} /> Maili aç</button>
              <button className="btn ghost" onClick={dismiss}><Icon name="check" size={15} /> Takibi kapat</button>
              {kind === "needs_reply" && (
                <button className="btn ghost" onClick={mute} title="Bu adresten gelenleri takip listelerinde gösterme (ör. otomatik raporlar)" data-testid="mute-sender">
                  <Icon name="close" size={15} /> Bu göndereni gösterme
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
