/** Yeni mail bildirimleri (Web Push): izin, servis çalışanı ve abonelik. */
import { api } from "./api";

export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export const isIos = () => /iP(hone|ad|od)/.test(navigator.userAgent);

export const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

function keyBytes(b64: string): Uint8Array {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Cihaz";
  const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return [os, br].filter(Boolean).join(" · ");
}

/** Uygulama açılınca: çalışanı kaydet, bildirime tıklanınca ilgili maili aç, aboneliği sunucuda tazele. */
export function initPush() {
  if (!pushSupported()) return;
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.type === "fm-open" && typeof e.data.url === "string") {
      const u = new URL(e.data.url, location.origin);
      if (u.origin === location.origin) location.hash = u.hash || "#/mail?view=inbox";
    }
  });
  navigator.serviceWorker.register("/sw.js").then(async (reg) => {
    const sub = await reg.pushManager.getSubscription();
    if (sub && Notification.permission === "granted") {
      api.post("/api/push/subscribe", { ...sub.toJSON(), label: deviceLabel() }).catch(() => undefined);
    }
  }).catch(() => undefined);
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function enablePush(): Promise<void> {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error(perm === "denied"
    ? "Bildirim izni reddedildi. Tarayıcı ayarlarından bu site için bildirimlere izin verin."
    : "Bildirim izni verilmedi.");
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const { public_key } = await api.get<{ public_key: string }>("/api/push/config");
  let sub: PushSubscription;
  try {
    sub = (await reg.pushManager.getSubscription())
      ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(public_key) as BufferSource }));
  } catch (e) {
    throw new Error(`Tarayıcı bildirim kaydını tamamlayamadı (${(e as Error).message}). Gizli pencerede olmadığınızdan emin olun; `
      + "iPhone'da FredyMail'i ana ekrandan açın.");
  }
  await api.post("/api/push/subscribe", { ...sub.toJSON(), label: deviceLabel() });
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.post("/api/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => undefined);
  await sub.unsubscribe();
}
