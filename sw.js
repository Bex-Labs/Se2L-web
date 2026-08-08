// SE2L-91: push notification service worker.
// Must live at the site root — a service worker's scope is limited to
// its own directory and everything below it, so placing this anywhere
// other than root (e.g. js/sw.js) would prevent it from controlling
// pages outside js/.

self.addEventListener("push", (event) => {
  let data = { title: "Se2L", body: "You have an update.", url: "/dashboard.html" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) {
    // Not JSON for some reason — fall back to the defaults above rather
    // than letting a malformed payload silently drop the notification.
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      // No icon/badge set — this project has no image assets yet
      // (checked; none exist). Browsers show a sensible default without
      // one. Add icon: "/path/to/real-icon.png" here once you have an
      // actual app icon file to use.
      data: { url: data.url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Resolves "dashboard.html" against this service worker's own scope
  // rather than hardcoding "/dashboard.html" — the same root-vs-
  // subdirectory issue as the registration path fix in push.js. This
  // way it's correct whether the site lives at a domain root or under
  // a subdirectory, without needing to know which at deploy time.
  const relativeTarget = event.notification.data?.url || "dashboard.html";
  const targetUrl = new URL(relativeTarget, self.registration.scope).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Focus an existing Se2L tab if one's already open, rather than
      // always opening a new one.
      for (const client of clientList) {
        if (client.url === targetUrl && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});