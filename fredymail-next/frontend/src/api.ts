/** Tek API istemcisi. Mutasyonlarda CSRF başlığı zorunlu; 401 → giriş ekranı. */

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let unauthorized: () => void = () => {};
export function onUnauthorized(fn: () => void) {
  unauthorized = fn;
}

function describe(status: number, data: unknown): string {
  const d = (data as { detail?: unknown } | null)?.detail;
  if (typeof d === "string") return d;
  if (status === 0) return "Sunucuya ulaşılamıyor. Bağlantınızı kontrol edin.";
  if (status === 404) return "Bulunamadı.";
  if (status === 422) return "Geçersiz istek.";
  if (status === 429) return "Çok fazla istek. Lütfen biraz bekleyin.";
  if (status >= 500) return `Sunucu hatası (${status}). Lütfen biraz sonra tekrar deneyin.`;
  return `İstek başarısız (${status}).`;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
    headers["X-Requested-With"] = "fredymail";
  }
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, describe(0, null));
  }
  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (res.status === 401 && !path.startsWith("/api/auth/")) unauthorized();
  if (!res.ok) throw new ApiError(res.status, describe(res.status, data));
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown = {}) => request<T>("POST", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};

export function qs(params: Record<string, unknown>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}
