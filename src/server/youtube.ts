/**
 * YouTube bağlantısı (Faz 7): Google OAuth (masaüstü uygulaması, geri dönüş adresi bu Mac, PKCE) ve
 * YouTube Data API v3 yükleme. API biçimi resmi keşif belgesinden alındı (youtube/v3, revizyon 20261106):
 * videos.insert (resumable), thumbnails.set, captions.insert (multipart), videos.list (status, processingDetails), channels.list.
 * Kullanıcı kendi Google Cloud projesinde “Masaüstü uygulaması” OAuth istemcisi oluşturur; istemci ve yenileme belirteci kasada saklanır.
 */
import { createHash, randomBytes } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import type { Secrets } from './secrets';

export const YT_SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.force-ssl'];
const AUTH_URL = () => process.env.FABRIKA_GOOGLE_AUTH_URL ?? 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = () => process.env.FABRIKA_GOOGLE_TOKEN_URL ?? 'https://oauth2.googleapis.com/token';
const API = () => process.env.FABRIKA_YOUTUBE_URL ?? 'https://youtube.googleapis.com';

export class YouTubeError extends Error {
  constructor(
    message: string,
    public kind: 'baglanti' | 'kota' | 'istek' | 'sunucu' | 'ag',
    public status = 0,
  ) {
    super(message);
  }
}

type Client = { clientId: string; clientSecret: string };
const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Google hata gövdesinden Türkçe açıklama (anahtar/belirteç asla iletiye girmez) */
const explain = async (r: Response, what: string): Promise<YouTubeError> => {
  let reason = '';
  let msg = '';
  try {
    const j = (await r.json()) as { error?: { message?: string; errors?: { reason?: string }[] } | string; error_description?: string };
    if (typeof j.error === 'string') {
      reason = j.error;
      msg = j.error_description ?? '';
    } else {
      reason = j.error?.errors?.[0]?.reason ?? '';
      msg = j.error?.message ?? '';
    }
  } catch {
    /* gövde yok */
  }
  if (r.status === 401 || reason === 'invalid_grant') return new YouTubeError('YouTube bağlantısının süresi dolmuş veya izin geri alınmış; hesabı yeniden bağlayın.', 'baglanti', r.status);
  if (reason === 'quotaExceeded' || reason === 'uploadLimitExceeded' || r.status === 429) return new YouTubeError('YouTube günlük yükleme/kota sınırına ulaşıldı; yarın tekrar deneyin.', 'kota', r.status);
  if (r.status === 403) return new YouTubeError(`YouTube izin vermedi (${what}): ${msg || reason}`.slice(0, 300), 'istek', r.status);
  if (r.status >= 500) return new YouTubeError(`YouTube geçici hata verdi (${what}, ${r.status}); biraz sonra tekrar deneyin.`, 'sunucu', r.status);
  return new YouTubeError(`YouTube isteği kabul etmedi (${what}): ${msg || reason || r.status}`.slice(0, 300), 'istek', r.status);
};

const fetchOk = async (url: string, init: RequestInit, what: string) => {
  let r: Response;
  try {
    r = await fetch(url, init);
  } catch (e) {
    throw new YouTubeError(`YouTube'a bağlanılamadı (${what}): ${(e as Error).message}`, 'ag');
  }
  if (!r.ok) throw await explain(r, what);
  return r;
};

export class YouTube {
  /** Süren yetkilendirmeler: state → PKCE doğrulayıcı */
  private pending = new Map<string, { verifier: string; redirect: string; at: number }>();
  private access: { token: string; until: number } | null = null;

  constructor(private secrets: Secrets) {}

  async client(): Promise<Client | null> {
    const v = await this.secrets.get('youtube');
    if (!v) return null;
    const i = v.lastIndexOf(':');
    if (i <= 0) return null;
    return { clientId: v.slice(0, i), clientSecret: v.slice(i + 1) };
  }
  async connected() {
    return !!(await this.secrets.get('youtube-token'));
  }

  /** Google onay sayfasının adresi (tarayıcı oraya yönlenir) */
  async authUrl(redirect: string) {
    const c = await this.client();
    if (!c) throw new YouTubeError('Önce OAuth istemci kimliğini ve gizli anahtarını ekleyin.', 'baglanti');
    const verifier = b64url(randomBytes(32));
    const state = b64url(randomBytes(16));
    for (const [k, p] of this.pending) if (Date.now() - p.at > 15 * 60_000) this.pending.delete(k);
    this.pending.set(state, { verifier, redirect, at: Date.now() });
    const q = new URLSearchParams({
      client_id: c.clientId,
      redirect_uri: redirect,
      response_type: 'code',
      scope: YT_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state,
      code_challenge: b64url(createHash('sha256').update(verifier).digest()),
      code_challenge_method: 'S256',
    });
    return `${AUTH_URL()}?${q}`;
  }

  /** Google'dan dönen kodu yenileme belirtecine çevirir ve kasaya yazar */
  async finish(code: string, state: string) {
    const p = this.pending.get(state);
    if (!p) throw new YouTubeError('Bağlantı isteği bulunamadı veya süresi doldu; yeniden deneyin.', 'baglanti');
    this.pending.delete(state);
    const c = (await this.client())!;
    const r = await fetchOk(
      TOKEN_URL(),
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: p.redirect, grant_type: 'authorization_code', code_verifier: p.verifier }),
      },
      'yetkilendirme',
    );
    const j = (await r.json()) as { refresh_token?: string; access_token: string; expires_in: number };
    if (!j.refresh_token) throw new YouTubeError('Google yenileme belirteci vermedi; Google hesabınızda bu uygulamanın erişimini kaldırıp yeniden bağlayın.', 'baglanti');
    await this.secrets.set('youtube-token', j.refresh_token);
    this.access = { token: j.access_token, until: Date.now() + (j.expires_in - 60) * 1000 };
    return this.channel();
  }

  async disconnect() {
    await this.secrets.remove('youtube-token');
    this.access = null;
  }

  private async token() {
    if (this.access && Date.now() < this.access.until) return this.access.token;
    const c = await this.client();
    const refresh = await this.secrets.get('youtube-token');
    if (!c || !refresh) throw new YouTubeError('YouTube hesabı bağlı değil.', 'baglanti');
    const r = await fetchOk(
      TOKEN_URL(),
      { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: refresh, grant_type: 'refresh_token' }) },
      'belirteç yenileme',
    );
    const j = (await r.json()) as { access_token: string; expires_in: number };
    this.access = { token: j.access_token, until: Date.now() + (j.expires_in - 60) * 1000 };
    return j.access_token;
  }
  private async auth() {
    return { authorization: `Bearer ${await this.token()}` };
  }

  /** Bağlı kanal (adı ve kimliği) */
  async channel(): Promise<{ id: string; title: string }> {
    const r = await fetchOk(`${API()}/youtube/v3/channels?part=snippet&mine=true`, { headers: await this.auth() }, 'kanal');
    const j = (await r.json()) as { items?: { id: string; snippet: { title: string } }[] };
    const ch = j.items?.[0];
    if (!ch) throw new YouTubeError('Bu Google hesabında YouTube kanalı yok.', 'istek');
    return { id: ch.id, title: ch.snippet.title };
  }

  /** Video yükleme (resumable: önce üst veri, sonra dosya). onProgress: 0–1 */
  async upload(
    file: string,
    meta: {
      title: string;
      description: string;
      tags: string[];
      privacyStatus: 'private' | 'unlisted' | 'public';
      publishAt?: string | null;
      madeForKids: boolean;
      containsSyntheticMedia: boolean;
      categoryId?: string;
    },
    onProgress: (f: number) => void,
  ): Promise<{ videoId: string }> {
    const { size } = await stat(file);
    const body = {
      snippet: { title: meta.title, description: meta.description, tags: meta.tags, categoryId: meta.categoryId ?? '22', defaultLanguage: 'tr', defaultAudioLanguage: 'tr' },
      status: {
        privacyStatus: meta.publishAt ? 'private' : meta.privacyStatus,
        ...(meta.publishAt ? { publishAt: meta.publishAt } : {}),
        selfDeclaredMadeForKids: meta.madeForKids,
        containsSyntheticMedia: meta.containsSyntheticMedia,
        embeddable: true,
      },
    };
    const init = await fetchOk(
      `${API()}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`,
      {
        method: 'POST',
        headers: { ...(await this.auth()), 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': 'video/mp4', 'x-upload-content-length': String(size) },
        body: JSON.stringify(body),
      },
      'yükleme başlatma',
    );
    const location = init.headers.get('location');
    if (!location) throw new YouTubeError('YouTube yükleme adresi vermedi.', 'sunucu');
    // Dosya 8 MB'lık parçalarla gönderilir (256 KB'ın katı); kopan bağlantıda kalınan yerden devam edilebilir
    const CHUNK = 8 * 1024 * 1024;
    const fh = await open(file, 'r');
    try {
      let offset = 0;
      while (offset < size) {
        const len = Math.min(CHUNK, size - offset);
        const buf = Buffer.alloc(len);
        await fh.read(buf, 0, len, offset);
        let r: Response;
        try {
          r = await fetch(location, {
            method: 'PUT',
            headers: { ...(await this.auth()), 'content-type': 'video/mp4', 'content-length': String(len), 'content-range': `bytes ${offset}-${offset + len - 1}/${size}` },
            body: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
          });
        } catch (e) {
          throw new YouTubeError(`Yükleme kesildi: ${(e as Error).message}`, 'ag');
        }
        if (r.status === 308) {
          const range = r.headers.get('range');
          offset = range ? Number(range.split('-')[1]) + 1 : offset + len;
          onProgress(offset / size);
          continue;
        }
        if (!r.ok) throw await explain(r, 'video yükleme');
        const j = (await r.json()) as { id: string };
        onProgress(1);
        return { videoId: j.id };
      }
      throw new YouTubeError('YouTube yüklemeyi tamamlamadı.', 'sunucu');
    } finally {
      await fh.close();
    }
  }

  async setThumbnail(videoId: string, jpg: Buffer) {
    await fetchOk(
      `${API()}/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`,
      { method: 'POST', headers: { ...(await this.auth()), 'content-type': 'image/jpeg', 'content-length': String(jpg.length) }, body: new Uint8Array(jpg) },
      'küçük resim',
    );
  }

  /** Altyazı (SRT) — multipart/related: üst veri + dosya */
  async addCaptions(videoId: string, srt: string, language = 'tr', name = 'Türkçe') {
    const boundary = `fabrika${b64url(randomBytes(9))}`;
    const meta = JSON.stringify({ snippet: { videoId, language, name, isDraft: false } });
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n${srt}\r\n--${boundary}--\r\n`;
    await fetchOk(
      `${API()}/upload/youtube/v3/captions?uploadType=multipart&part=snippet`,
      { method: 'POST', headers: { ...(await this.auth()), 'content-type': `multipart/related; boundary=${boundary}` }, body },
      'altyazı',
    );
  }

  async status(videoId: string) {
    const r = await fetchOk(`${API()}/youtube/v3/videos?part=status,processingDetails&id=${encodeURIComponent(videoId)}`, { headers: await this.auth() }, 'durum');
    const j = (await r.json()) as {
      items?: { status?: { uploadStatus?: string; privacyStatus?: string; failureReason?: string; rejectionReason?: string; publishAt?: string }; processingDetails?: { processingStatus?: string } }[];
    };
    const it = j.items?.[0];
    if (!it) return { found: false as const };
    return {
      found: true as const,
      uploadStatus: it.status?.uploadStatus ?? '',
      privacyStatus: it.status?.privacyStatus ?? '',
      processing: it.processingDetails?.processingStatus ?? '',
      problem: it.status?.failureReason || it.status?.rejectionReason || '',
      publishAt: it.status?.publishAt ?? null,
    };
  }
}
