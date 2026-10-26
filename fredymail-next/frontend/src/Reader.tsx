import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { AiPanel } from "./AiPanel";
import type { SearchState } from "./route";
import { useStore } from "./store";
import type { MessageDetail, MessageItem, NoteT, ThreadT } from "./types";
import { avatarColor, FILE_ICON, fmtLongDate, fmtSize, folderLabel, initials, snoozePresets, toLocalInput } from "./util";
import { Banner, Empty, Icon, Spinner } from "./ui";

interface Props {
  msgId: number;
  search: SearchState | null;
  followupThreadId?: number | null;
  onBack: () => void;
  onChanged: (m: MessageItem) => void;
  onOpenMessage: (id: number) => void;
  onDismissed?: () => void;
}

type Menu = null | "snooze" | "tag";

export function Reader(p: Props) {
  const [thread, setThread] = useState<ThreadT | null>(null);
  const [single, setSingle] = useState<MessageDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"mail" | "ai">("mail");
  const [menu, setMenu] = useState<Menu>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [noteFocus, setNoteFocus] = useState(0);
  const [aiAuto, setAiAuto] = useState<string | null>(null);
  const { toast, refreshTags, refreshFolders, refreshCounts, folders } = useStore();
  const folderName = (id: number, path: string) => {
    const f = folders.find((x) => x.id === id);
    return f ? (f.origin === "import" ? `Outlook / ${f.display_name}` : folderLabel(f)) : path;
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const m = await api.get<MessageDetail>(`/api/messages/${p.msgId}`);
      setSingle(m);
      if (m.thread_id) {
        const t = await api.get<ThreadT>(`/api/threads/${m.thread_id}`);
        setThread(t);
      } else {
        setThread(null);
      }
      setExpanded(new Set([m.id]));
      if (!m.is_read) {
        api.patch<MessageItem>(`/api/messages/${m.id}`, { is_read: true }).then((u) => {
          p.onChanged(u);
          refreshFolders();
        }).catch(() => undefined);
      }
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.msgId]);

  useEffect(() => {
    load();
    setMenu(null);
  }, [load]);

  const current: MessageDetail | null =
    thread?.messages.find((m) => m.id === p.msgId) ?? single;

  const replaceMsg = useCallback((u: Partial<MessageDetail> & { id: number }) => {
    setThread((t) => (t ? { ...t, messages: t.messages.map((m) => (m.id === u.id ? { ...m, ...u } : m)) } : t));
    setSingle((s) => (s && s.id === u.id ? { ...s, ...u } : s));
  }, []);

  async function patch(body: Record<string, unknown>, okText?: string) {
    if (!current) return;
    try {
      const u = await api.patch<MessageItem>(`/api/messages/${current.id}`, body);
      replaceMsg({ ...u, attachments: current.attachments });
      p.onChanged(u);
      if (okText) toast(okText, "ok");
      refreshFolders();
    } catch (e) {
      toast((e as ApiError).message, "error");
    }
  }

  // klavye kısayolları (App tarafından yayınlanır)
  useEffect(() => {
    const on = (e: Event) => {
      const a = (e as CustomEvent<string>).detail;
      if (!current) return;
      if (a === "unread") patch({ is_read: !current.is_read }, current.is_read ? "Okunmadı olarak işaretlendi" : "Okundu");
      if (a === "important") patch({ is_important: !current.is_important });
      if (a === "snooze") setMenu("snooze");
      if (a === "tag") setMenu("tag");
      if (a === "note") {
        setTab("mail");
        setNoteFocus((n) => n + 1);
      }
      if (a === "ai") {
        setTab("ai");
        setAiAuto(current.thread_count > 1 ? "thread_summary" : "summary");
      }
      if (a === "close-menu") setMenu(null);
    };
    window.addEventListener("fm-action", on);
    return () => window.removeEventListener("fm-action", on);
  });

  if (loading && !current) {
    return (
      <section className="reader" aria-label="Mail">
        <div className="reader-toolbar"><button className="icon-btn only-mobile" onClick={p.onBack} aria-label="Geri"><Icon name="back" /></button></div>
        <Spinner />
      </section>
    );
  }
  if (error || !current) {
    return (
      <section className="reader" aria-label="Mail">
        <div className="reader-toolbar"><button className="icon-btn only-mobile" onClick={p.onBack} aria-label="Geri"><Icon name="back" /></button></div>
        <div className="pad">
          <Banner kind="error">
            {error ?? "Mail bulunamadı."} <button className="link" onClick={load}>Tekrar dene</button>
          </Banner>
        </div>
      </section>
    );
  }

  const msgs = thread?.messages ?? [current];

  return (
    <section className="reader" aria-label="Mail">
      <div className="reader-toolbar" role="toolbar" aria-label="Mail eylemleri">
        <button className="icon-btn only-mobile" onClick={p.onBack} aria-label="Listeye dön">
          <Icon name="back" />
        </button>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "mail"} className={`tab ${tab === "mail" ? "on" : ""}`} onClick={() => setTab("mail")}>
            Mail
          </button>
          <button role="tab" aria-selected={tab === "ai"} className={`tab ${tab === "ai" ? "on" : ""}`} onClick={() => setTab("ai")}>
            <Icon name="sparkle" size={15} /> AI<span className="hide-xs">&nbsp;asistan</span>
          </button>
        </div>
        <div className="toolbar-actions">
          <button className="icon-btn" onClick={() => patch({ is_read: !current.is_read })} title={current.is_read ? "Okunmadı yap (u)" : "Okundu yap (u)"} aria-label={current.is_read ? "Okunmadı yap" : "Okundu yap"}>
            <Icon name="unread" />
          </button>
          <button className={`icon-btn ${current.is_important ? "on-star" : ""}`} onClick={() => patch({ is_important: !current.is_important })} title="Önemli (s)" aria-label="Önemli" aria-pressed={current.is_important}>
            <Icon name="star" />
          </button>
          <div className="menu-anchor">
            <button className={`icon-btn ${current.snoozed_until ? "on" : ""}`} onClick={() => setMenu(menu === "snooze" ? null : "snooze")} title="Ertele (z)" aria-label="Ertele" aria-haspopup="menu" aria-expanded={menu === "snooze"}>
              <Icon name="clock" />
            </button>
            {menu === "snooze" && <SnoozeMenu current={current.snoozed_until} onPick={(iso) => { setMenu(null); if (iso) patch({ snoozed_until: iso }, "Ertelendi; zamanı gelince gelen kutusuna döner"); else patch({ clear_snooze: true }, "Erteleme kaldırıldı"); }} onClose={() => setMenu(null)} />}
          </div>
          <div className="menu-anchor">
            <button className="icon-btn" onClick={() => setMenu(menu === "tag" ? null : "tag")} title="Etiket (l)" aria-label="Etiket" aria-haspopup="menu" aria-expanded={menu === "tag"}>
              <Icon name="tag" />
            </button>
            {menu === "tag" && (
              <TagMenu
                msg={current}
                onClose={() => setMenu(null)}
                onUpdated={(u) => {
                  replaceMsg({ ...u, attachments: current.attachments });
                  p.onChanged(u);
                  refreshTags();
                }}
              />
            )}
          </div>
          <button className="icon-btn" onClick={() => { setTab("mail"); setNoteFocus((n) => n + 1); }} title="Not ekle (n)" aria-label="Not ekle">
            <Icon name="note" />
          </button>
          {p.followupThreadId && (
            <button
              className="btn sm"
              onClick={async () => {
                try {
                  await api.post(`/api/threads/${p.followupThreadId}/dismiss-followup`);
                  toast("Takip kapatıldı", "ok");
                  refreshCounts();
                  p.onDismissed?.();
                } catch (e) {
                  toast((e as ApiError).message, "error");
                }
              }}
            >
              <Icon name="check" size={14} /> Takibi kapat
            </button>
          )}
        </div>
      </div>

      {tab === "ai" ? (
        <AiPanel
          message={current}
          threadId={current.thread_id}
          threadCount={msgs.length}
          search={p.search}
          auto={aiAuto}
          onAutoDone={() => setAiAuto(null)}
          onOpenMessage={(id) => {
            setTab("mail");
            if (msgs.some((m) => m.id === id)) {
              setExpanded((s) => new Set(s).add(id));
              window.setTimeout(() => document.getElementById(`msg-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
            } else {
              p.onOpenMessage(id);
            }
          }}
        />
      ) : (
        <div className="reader-scroll">
          <header className="thread-head">
            <h1>{thread?.subject || current.subject}</h1>
            <div className="muted small">
              {msgs.length > 1 ? `${msgs.length} mesajlık yazışma · ` : ""}
              {current.folders.map((f) => folderName(f.id, f.path)).join(" · ")}
              {current.snoozed_until && ` · Ertelendi: ${new Date(current.snoozed_until).toLocaleString("tr-TR")}`}
            </div>
            {current.tags.length > 0 && (
              <div className="row-meta">
                {current.tags.map((t) => (
                  <span key={t.id} className="pill tag" style={{ borderColor: t.color, color: t.color }}>{t.name}</span>
                ))}
              </div>
            )}
          </header>
          {msgs.map((m) => (
            <MessageCard
              key={m.id}
              m={m}
              open={expanded.has(m.id) || msgs.length === 1}
              focused={m.id === current.id}
              toggle={() => setExpanded((s) => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })}
              noteFocus={m.id === current.id ? noteFocus : 0}
              onNotes={(notes) => replaceMsg({ id: m.id, notes, has_note: notes.length > 0 })}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function MessageCard({ m, open, focused, toggle, noteFocus, onNotes }: {
  m: MessageDetail;
  open: boolean;
  focused: boolean;
  toggle: () => void;
  noteFocus: number;
  onNotes: (n: NoteT[]) => void;
}) {
  const [remote, setRemote] = useState(false);
  const [height, setHeight] = useState(420);
  const { meta } = useStore();
  const atts = m.attachments.filter((a) => !a.is_inline);
  const to = m.to.map((a) => a.name || a.email).join(", ");
  const cc = m.cc.map((a) => a.name || a.email).join(", ");

  if (!open) {
    return (
      <article className="msg-card collapsed" id={`msg-${m.id}`}>
        <button className="msg-collapsed" onClick={toggle} aria-expanded="false">
          <span className="avatar sm" style={{ background: avatarColor(m.from_email) }} aria-hidden="true">{initials(m.from_name, m.from_email)}</span>
          <span className="msg-from">{m.from_name || m.from_email}</span>
          <span className="msg-snip">{m.snippet}</span>
          <span className="muted small nowrap">{fmtLongDate(m.date)}</span>
        </button>
      </article>
    );
  }

  return (
    <article className={`msg-card ${focused ? "focused" : ""}`} id={`msg-${m.id}`} aria-label={`${m.from_name || m.from_email} tarafından gönderilen mail`}>
      <header className="msg-head" onClick={toggle}>
        <span className="avatar" style={{ background: avatarColor(m.from_email) }} aria-hidden="true">{initials(m.from_name, m.from_email)}</span>
        <div className="msg-head-main">
          <div className="msg-from-line">
            <strong>{m.from_name || m.from_email}</strong>
            <span className="muted small">&lt;{m.from_email}&gt;</span>
            {m.is_from_me && <span className="pill">Ben</span>}
          </div>
          <div className="muted small">Kime: {to || "—"}{cc && ` · Bilgi: ${cc}`}</div>
        </div>
        <time className="muted small nowrap" dateTime={m.date ?? undefined}>{fmtLongDate(m.date)}</time>
      </header>

      {m.injection_suspected && (
        <Banner kind="error">
          Bu mail yapay zekaya talimat vermeye çalışıyor olabilir. FredyMail'in AI asistanı bu talimatları uygulamaz; yine de içeriğe dikkat edin.
        </Banner>
      )}
      {m.body_truncated && <Banner kind="info">Büyük mail: yalnızca metin kısmı alındı. Ekler aşağıdan tek tek indirilebilir.</Banner>}
      {m.deleted_on_server && <Banner kind="warn">Bu mail sunucudan silinmiş veya taşınmış görünüyor.</Banner>}

      {m.has_html ? (
        <div className="html-wrap">
          <div className="html-bar">
            <span className="muted small">Güvenli görünüm: betikler kapalı{remote ? ", uzak görseller açık" : ", uzak görseller engellendi"}</span>
            {!remote && (
              <button className="link small" onClick={() => setRemote(true)}>
                Uzak görselleri göster
              </button>
            )}
          </div>
          <iframe
            title={`Mail içeriği: ${m.subject}`}
            className="mail-frame"
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            src={`/api/messages/${m.id}/html${remote ? "?remote=true" : ""}`}
            style={{ height }}
          />
          <div className="frame-resize">
            <button className="link small" onClick={() => setHeight((h) => Math.min(h + 400, 3000))}>Daha uzun göster</button>
            {height > 420 && <button className="link small" onClick={() => setHeight(420)}>Küçült</button>}
          </div>
        </div>
      ) : (
        <div className="body-text">{m.body_text || <span className="muted">(boş mail)</span>}</div>
      )}

      {atts.length > 0 && (
        <div className="atts" aria-label="Ekler">
          {atts.map((a) => (
            <a key={a.id} className="att-card" href={`/api/messages/${m.id}/attachments/${a.id}`} download={a.filename} title={`${a.filename} indir`}>
              <span className={`att-ico k-${a.file_kind}`}>{FILE_ICON[a.file_kind] ?? "DOS"}</span>
              <span className="att-info">
                <span className="ellipsis">{a.filename}</span>
                <span className="muted small">{fmtSize(a.size)} · {meta?.file_kinds[a.file_kind] ?? a.file_kind}</span>
              </span>
              <Icon name="download" size={16} />
            </a>
          ))}
        </div>
      )}

      {(focused || m.notes.length > 0) && <Notes msg={m} focusTick={noteFocus} onNotes={onNotes} />}
    </article>
  );
}

function Notes({ msg, focusTick, onNotes }: { msg: MessageDetail; focusTick: number; onNotes: (n: NoteT[]) => void }) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const { toast } = useStore();

  useEffect(() => {
    if (focusTick) {
      ref.current?.focus();
      ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [focusTick]);

  async function add() {
    if (!text.trim()) return;
    try {
      const n = await api.post<NoteT>(`/api/messages/${msg.id}/notes`, { body: text.trim() });
      onNotes([...msg.notes, n]);
      setText("");
      toast("Not kaydedildi", "ok");
    } catch (e) {
      toast((e as ApiError).message, "error");
    }
  }

  return (
    <section className="notes" aria-label="Kişisel notlar">
      <div className="notes-title"><Icon name="note" size={15} /> Kişisel notlar <span className="muted small">(yalnızca FredyMail'de)</span></div>
      {msg.notes.map((n) =>
        editing === n.id ? (
          <div key={n.id} className="note editing">
            <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} aria-label="Notu düzenle" />
            <div className="row gap">
              <button className="btn sm primary" onClick={async () => {
                try {
                  await api.patch(`/api/notes/${n.id}`, { body: editText });
                  onNotes(msg.notes.map((x) => (x.id === n.id ? { ...x, body: editText } : x)));
                  setEditing(null);
                } catch (e) {
                  toast((e as ApiError).message, "error");
                }
              }}>Kaydet</button>
              <button className="btn sm" onClick={() => setEditing(null)}>Vazgeç</button>
            </div>
          </div>
        ) : (
          <div key={n.id} className="note">
            <div className="note-body">{n.body}</div>
            <div className="note-foot">
              <span className="muted small">{new Date(n.updated_at).toLocaleString("tr-TR")}</span>
              <button className="link small" onClick={() => { setEditing(n.id); setEditText(n.body); }}>Düzenle</button>
              <button className="link small danger" onClick={async () => {
                if (!window.confirm("Not silinsin mi?")) return;
                await api.del(`/api/notes/${n.id}`).catch(() => undefined);
                onNotes(msg.notes.filter((x) => x.id !== n.id));
              }}>Sil</button>
            </div>
          </div>
        ),
      )}
      <div className="note-new">
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="Not ekle… (ör. fiyat teklifi Perşembe'ye kadar bekleniyor)"
          aria-label="Yeni not"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) add();
          }}
        />
        <button className="btn sm" onClick={add} disabled={!text.trim()}>Notu kaydet</button>
      </div>
    </section>
  );
}

function SnoozeMenu({ current, onPick, onClose }: { current: string | null; onPick: (iso: string | null) => void; onClose: () => void }) {
  const [custom, setCustom] = useState(false);
  const [val, setVal] = useState(toLocalInput(new Date(Date.now() + 86400000)));
  useOutside(onClose);
  return (
    <div className="menu" role="menu" aria-label="Ertele">
      <div className="menu-title">Ertele — gelen kutusundan gizle, zamanı gelince geri getir</div>
      {snoozePresets().map((s) => (
        <button key={s.label} role="menuitem" className="menu-item" onClick={() => onPick(s.at.toISOString())}>
          <span>{s.label}</span>
          <span className="muted small">{s.at.toLocaleString("tr-TR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
        </button>
      ))}
      {custom ? (
        <div className="menu-custom">
          <input type="datetime-local" value={val} onChange={(e) => setVal(e.target.value)} aria-label="Özel erteleme zamanı" />
          <button className="btn sm primary" onClick={() => onPick(new Date(val).toISOString())}>Ertele</button>
        </div>
      ) : (
        <button role="menuitem" className="menu-item" onClick={() => setCustom(true)}>Özel tarih ve saat…</button>
      )}
      {current && (
        <button role="menuitem" className="menu-item danger" onClick={() => onPick(null)}>Ertelemeyi kaldır</button>
      )}
    </div>
  );
}

function TagMenu({ msg, onClose, onUpdated }: { msg: MessageDetail; onClose: () => void; onUpdated: (m: MessageItem) => void }) {
  const { tags, toast } = useStore();
  const [name, setName] = useState("");
  useOutside(onClose);
  const has = new Set(msg.tags.map((t) => t.id));
  async function toggle(id: number) {
    try {
      const u = has.has(id)
        ? await api.del<MessageItem>(`/api/messages/${msg.id}/tags/${id}`)
        : await api.post<MessageItem>(`/api/messages/${msg.id}/tags`, { tag_id: id });
      onUpdated(u);
    } catch (e) {
      toast((e as ApiError).message, "error");
    }
  }
  async function create() {
    if (!name.trim()) return;
    try {
      const u = await api.post<MessageItem>(`/api/messages/${msg.id}/tags`, { name: name.trim() });
      onUpdated(u);
      setName("");
    } catch (e) {
      toast((e as ApiError).message, "error");
    }
  }
  return (
    <div className="menu" role="menu" aria-label="Etiketler">
      <div className="menu-title">Etiketler</div>
      {tags.length === 0 && <div className="muted small pad-sm">Henüz etiket yok.</div>}
      {tags.map((t) => (
        <button key={t.id} role="menuitemcheckbox" aria-checked={has.has(t.id)} className="menu-item" onClick={() => toggle(t.id)}>
          <span className="row gap-sm"><span className="tag-dot" style={{ background: t.color }} /> {t.name}</span>
          {has.has(t.id) && <Icon name="check" size={15} />}
        </button>
      ))}
      <form className="menu-custom" onSubmit={(e) => { e.preventDefault(); create(); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Yeni etiket" aria-label="Yeni etiket adı" autoFocus />
        <button className="btn sm primary" disabled={!name.trim()}>Ekle</button>
      </form>
    </div>
  );
}

function useOutside(onClose: () => void) {
  useEffect(() => {
    const on = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest(".menu") && !t.closest(".menu-anchor")) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", on);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", on);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);
}

export function ReaderEmpty() {
  return (
    <section className="reader empty-reader" aria-label="Mail">
      <Empty icon="unread" title="Bir mail seçin">
        Okumak için listeden bir mail seçin. <kbd>j</kbd>/<kbd>k</kbd> ile gezinebilir, <kbd>?</kbd> ile kısayolları görebilirsiniz.
      </Empty>
    </section>
  );
}
