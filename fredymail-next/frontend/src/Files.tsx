/** "Dosyaları göster": listedeki maillerin ekleri (imza görselleri hariç), türe göre süzülebilir, indirilebilir. */
import { useEffect, useState } from "react";
import { api, ApiError, qs } from "./api";
import { searchParams, type SearchState } from "./route";
import { useStore } from "./store";
import { fmtListDate, fmtSize } from "./util";
import { Banner, Empty, FileIcon, Icon, Modal, Skeleton } from "./ui";

interface FileRow { id: number; message_id: number; filename: string; file_kind: string; size: number | null; date: string | null; subject: string; from: string; is_from_me: boolean }
interface FilesResp { total: number; kinds: Record<string, number>; items: FileRow[] }

export function FilesModal({ search, title, onOpen, onClose }: { search: SearchState; title: string; onOpen: (id: number) => void; onClose: () => void }) {
  const { meta } = useStore();
  const [kind, setKind] = useState(search.file_kind);
  const [data, setData] = useState<FilesResp | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchPage = (pg: number) => {
    const { facets: _f, ...p } = searchParams({ ...search, file_kind: kind }, pg);
    void _f;
    return api.get<FilesResp>(`/api/attachments${qs({ ...p, per_page: 100 })}`);
  };
  useEffect(() => {
    setData(null);
    setError(null);
    setPage(1);
    fetchPage(1).then(setData).catch((e: ApiError) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  async function more() {
    setBusy(true);
    try {
      const r = await fetchPage(page + 1);
      setData((d) => (d ? { ...d, items: [...d.items, ...r.items] } : r));
      setPage(page + 1);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  const kinds = Object.entries(data?.kinds ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <Modal title={`Dosyalar · ${title}`} onClose={onClose} wide>
      {kinds.length > 1 && (
        <div className="chip-row" style={{ marginBottom: 12 }} role="group" aria-label="Dosya türü">
          <button className={`chip sm ${!kind ? "on" : ""}`} onClick={() => setKind("")}>Tümü</button>
          {kinds.map(([k, c]) => (
            <button key={k} className={`chip sm ${kind === k ? "on" : ""}`} onClick={() => setKind(kind === k ? "" : k)}>
              {meta?.file_kinds[k] ?? k} <span className="count">{c}</span>
            </button>
          ))}
        </div>
      )}
      {error && <Banner kind="error">{error}</Banner>}
      {!data && !error && <Skeleton rows={6} />}
      {data && !data.items.length && <Empty art="search" title="Bu listede dosya yok">Filtreleri değiştirip tekrar deneyin.</Empty>}
      {data && data.items.length > 0 && (
        <>
          <div className="muted small" style={{ marginBottom: 8 }}>{data.total.toLocaleString("tr-TR")} dosya · yeniden eskiye</div>
          <ul className="file-list" data-testid="files-list">
            {data.items.map((f) => (
              <li key={f.id} className="file-row">
                <FileIcon kind={f.file_kind} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="file-name ellipsis" title={f.filename}>{f.filename}</div>
                  <div className="muted xs ellipsis">{f.is_from_me ? "Gönderdiğim" : f.from} · {fmtListDate(f.date)}{f.size ? ` · ${fmtSize(f.size)}` : ""} · {f.subject || "(konu yok)"}</div>
                </div>
                <a className="btn sm" href={`/api/messages/${f.message_id}/attachments/${f.id}`} download={f.filename} title="İndir">
                  <Icon name="download" size={15} /> <span className="hide-mobile">İndir</span>
                </a>
                <button className="btn sm ghost" onClick={() => onOpen(f.message_id)} title="Maili aç">
                  <Icon name="unread" size={15} /> <span className="hide-mobile">Mail</span>
                </button>
              </li>
            ))}
          </ul>
          {data.items.length < data.total && (
            <div className="list-foot">
              <button className="btn" onClick={more} disabled={busy}>
                {busy ? "Yükleniyor…" : `Daha fazla göster (${(data.total - data.items.length).toLocaleString("tr-TR")} kaldı)`}
              </button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
