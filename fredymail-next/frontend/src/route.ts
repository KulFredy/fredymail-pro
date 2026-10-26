import { useEffect, useState } from "react";

/** Hash tabanlı yönlendirme: durum URL'de tutulur, yenilemede korunur.
 *  #/mail?view=inbox&q=...&msg=12   #/pano?period=this_month   #/sor?q=...   #/followups/needs_reply?msg=3
 *  #/tasks   #/drafts/5   #/settings */

export interface SearchState {
  q: string;
  view: string;
  folder_id: string;
  sender: string;
  recipient: string;
  participant: string;
  direction: string; // "" | "in" | "out"
  date_from: string;
  date_to: string;
  year: string;
  has_attachment: string; // "" | "true" | "false"
  file_kind: string;
  doc_kind: string;
  tag_id: string;
  unread: string; // "" | "true"
  important: string;
  sort: string;
  smart: string; // akıllı klasör kimliği (yalnızca vurgulama için)
}

export const EMPTY_SEARCH: SearchState = {
  q: "",
  view: "inbox",
  folder_id: "",
  sender: "",
  recipient: "",
  participant: "",
  direction: "",
  date_from: "",
  date_to: "",
  year: "",
  has_attachment: "",
  file_kind: "",
  doc_kind: "",
  tag_id: "",
  unread: "",
  important: "",
  sort: "",
  smart: "",
};

export type FollowKind = "needs_reply" | "awaiting";

export type Route =
  | { page: "mail"; search: SearchState; msg: number | null }
  | { page: "dashboard"; period: string }
  | { page: "ask"; q: string }
  | { page: "followups"; kind: FollowKind; msg: number | null }
  | { page: "tasks" }
  | { page: "drafts"; draft: number | null }
  | { page: "settings" };

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#/, "") || "/mail";
  const [path, query = ""] = h.split("?");
  const p = new URLSearchParams(query);
  const parts = path.split("/").filter(Boolean);
  const msg = p.get("msg") ? Number(p.get("msg")) : null;
  if (parts[0] === "pano") return { page: "dashboard", period: p.get("period") || "this_month" };
  if (parts[0] === "sor") return { page: "ask", q: p.get("q") ?? "" };
  if (parts[0] === "followups") {
    return { page: "followups", kind: parts[1] === "awaiting" ? "awaiting" : "needs_reply", msg };
  }
  if (parts[0] === "tasks") return { page: "tasks" };
  if (parts[0] === "drafts") return { page: "drafts", draft: parts[1] ? Number(parts[1]) : null };
  if (parts[0] === "settings") return { page: "settings" };
  const search = { ...EMPTY_SEARCH };
  for (const k of Object.keys(EMPTY_SEARCH) as (keyof SearchState)[]) {
    const v = p.get(k);
    if (v !== null) search[k] = v;
  }
  if (!p.get("view")) search.view = search.q || hasFilters(search) ? "all" : "inbox";
  return { page: "mail", search, msg };
}

const FILTER_KEYS: (keyof SearchState)[] = ["folder_id", "sender", "recipient", "participant", "direction", "date_from", "date_to",
  "year", "has_attachment", "file_kind", "doc_kind", "tag_id", "unread", "important"];

export function hasFilters(s: SearchState): boolean {
  return FILTER_KEYS.some((k) => s[k] !== "");
}

export function buildHash(r: Route): string {
  if (r.page === "dashboard") return `#/pano${r.period && r.period !== "this_month" ? `?period=${r.period}` : ""}`;
  if (r.page === "ask") return `#/sor${r.q ? `?q=${encodeURIComponent(r.q)}` : ""}`;
  if (r.page === "followups") return `#/followups/${r.kind}${r.msg ? `?msg=${r.msg}` : ""}`;
  if (r.page === "tasks") return "#/tasks";
  if (r.page === "drafts") return `#/drafts${r.draft ? `/${r.draft}` : ""}`;
  if (r.page === "settings") return "#/settings";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(r.search)) if (v !== "" && !(k === "view" && v === "inbox")) p.set(k, v);
  if (r.msg) p.set("msg", String(r.msg));
  const s = p.toString();
  return `#/mail${s ? `?${s}` : ""}`;
}

export function navigate(r: Route, replace = false) {
  const h = buildHash(r);
  if (h === window.location.hash) return;
  if (replace) window.history.replaceState(null, "", h);
  else window.history.pushState(null, "", h);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

/** Filtre değişikliğiyle posta listesine git (gelen kutusu yerine "tümü" görünümü). */
export function goMail(patch: Partial<SearchState>, msg: number | null = null) {
  const next = { ...EMPTY_SEARCH, ...patch };
  if (!patch.view) next.view = next.q || hasFilters(next) ? "all" : "inbox";
  navigate({ page: "mail", search: next, msg });
}

/** /api/ask'in döndürdüğü arama parametrelerini liste durumuna çevirir. */
export function fromParams(params: Record<string, unknown>, extra: Record<string, string> = {}): Partial<SearchState> {
  const out: Partial<SearchState> = {};
  for (const k of Object.keys(EMPTY_SEARCH) as (keyof SearchState)[]) {
    const v = params[k];
    if (v !== undefined && v !== null && v !== "" && v !== false) out[k] = String(v);
  }
  if (out.sort === "date_desc" && !out.q) delete out.sort;
  return { ...out, ...extra };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", on);
    window.addEventListener("popstate", on);
    return () => {
      window.removeEventListener("hashchange", on);
      window.removeEventListener("popstate", on);
    };
  }, []);
  return route;
}

/** Arama durumunu API parametrelerine çevirir. */
export function searchParams(s: SearchState, page: number) {
  return {
    q: s.q,
    view: s.view === "folder" ? "all" : s.view,
    folder_id: s.folder_id,
    sender: s.sender,
    recipient: s.recipient,
    participant: s.participant,
    direction: s.direction,
    date_from: s.date_from,
    date_to: s.date_to,
    year: s.year,
    has_attachment: s.has_attachment,
    file_kind: s.file_kind,
    doc_kind: s.doc_kind,
    tag_id: s.tag_id,
    unread: s.unread,
    important: s.important,
    sort: s.sort,
    page,
    per_page: 50,
    facets: page === 1,
  };
}
