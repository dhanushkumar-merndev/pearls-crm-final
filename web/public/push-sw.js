/* Pearl CRM pop-up notifications (Phase 20a). The browser runs this in the background; it shows a bell
 * notification that push-send delivered through Firebase Cloud Messaging, and opens it when clicked.
 * No Firebase code here: the page gets the token (lib/push/web-push.ts); FCM's data message arrives as
 * { data: { id, type, title, body, link } }. Nothing pops up while a CRM tab is in front — the bell
 * there updates live — except "Send a test", which always shows. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function readPush(event) {
  try {
    const json = event.data ? event.data.json() : null;
    const d = (json && (json.data || (json.notification && json))) || null;
    if (!d || !d.title) return null;
    return {
      id: String(d.id || ""),
      type: String(d.type || ""),
      title: String(d.title).slice(0, 200),
      body: String(d.body || "").slice(0, 1000),
      link: String(d.link || ""),
    };
  } catch {
    return null;
  }
}

/** Only links inside the CRM ("/leads/…"); anything else opens the notifications page. */
function safePath(link) {
  return typeof link === "string" && link.startsWith("/") && !link.startsWith("//")
    ? link
    : "/notifications";
}

self.addEventListener("push", (event) => {
  const n = readPush(event);
  if (!n) return;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((tabs) => {
      if (n.type !== "push_test" && tabs.some((t) => t.visibilityState === "visible" && t.focused))
        return undefined;
      return self.registration.showNotification(n.title, {
        body: n.body,
        tag: n.id || undefined,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        data: { path: safePath(n.link) },
      });
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safePath(event.notification.data && event.notification.data.path);
  const url = new URL(path, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((tabs) => {
      const tab = tabs.find((t) => new URL(t.url).origin === self.location.origin);
      if (tab) return tab.focus().then((t) => (t && "navigate" in t ? t.navigate(url) : undefined));
      return self.clients.openWindow(url);
    }),
  );
});
