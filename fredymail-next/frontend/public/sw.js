/* FredyMail bildirim çalışanı: yalnızca yeni mail bildirimlerini gösterir.
   Önbellek tutmaz, ağ isteklerini yakalamaz; mail içeriği yalnızca şifreli bildirimle gelen konu satırıdır. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

function sameOrigin(url) {
  try {
    const u = new URL(url || "/", self.location.origin);
    return u.origin === self.location.origin ? u.href : self.location.origin + "/";
  } catch {
    return self.location.origin + "/";
  }
}

self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(d.title || "Yeni mail", {
      body: d.body || "",
      tag: d.tag || undefined,
      renotify: !!d.tag,
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      data: { url: sameOrigin(d.url) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = sameOrigin(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const w = wins.find((c) => new URL(c.url).origin === self.location.origin);
      if (w) {
        w.postMessage({ type: "fm-open", url });
        return w.focus();
      }
      return self.clients.openWindow(url);
    })(),
  );
});
