// SE2L-91: push notification subscription management.
// Loaded on settings.html, where the actual opt-in toggle lives.

// This is the VAPID PUBLIC key only — public keys are meant to be
// embedded client-side, that's how Web Push authentication is designed
// to work. The matching PRIVATE key lives only in the edge function's
// environment secrets, never in any file that reaches the browser.
const PUSH_VAPID_PUBLIC_KEY = "BEuUGqGdHN15qO11fz88xZis2UYp9iumsh3TTt1aLjglHm3X0D0NITkCzYhNCe-eoIXFd7_EhaegmP_XMtlh8J0";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

function isPushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window;
}

async function getExistingSubscription() {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

async function subscribeToPush(userId) {
  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(PUSH_VAPID_PUBLIC_KEY),
  });

  const subJson = subscription.toJSON();
  const { error } = await supabaseClient.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: subJson.endpoint,
      p256dh: subJson.keys.p256dh,
      auth: subJson.keys.auth,
      user_agent: navigator.userAgent,
    },
    { onConflict: "user_id,endpoint" }
  );

  if (error) throw error;
  return subscription;
}

async function unsubscribeFromPush(userId) {
  const subscription = await getExistingSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await supabaseClient.from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", endpoint);
}

// --- Wiring for the settings.html toggle ---
(async function initPushToggle() {
  const toggle = document.getElementById("push-toggle");
  const message = document.getElementById("push-message");
  const unsupportedNote = document.getElementById("push-unsupported");
  if (!toggle) return; // Not on a page with this UI.

  if (!isPushSupported()) {
    toggle.disabled = true;
    if (unsupportedNote) unsupportedNote.classList.remove("hidden");
    return;
  }

  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  const existing = await getExistingSubscription().catch(() => null);
  toggle.checked = !!existing;

  toggle.addEventListener("change", async () => {
    toggle.disabled = true;
    message?.classList.add("hidden");
    try {
      if (toggle.checked) {
        if (Notification.permission === "denied") {
          toggle.checked = false;
          message.textContent = "Notifications are blocked for this site in your browser settings — enable them there first.";
          message.classList.remove("hidden");
          return;
        }
        await subscribeToPush(user.id);
        message.textContent = "Push notifications enabled.";
      } else {
        await unsubscribeFromPush(user.id);
        message.textContent = "Push notifications turned off.";
      }
      message.classList.remove("hidden");
    } catch (err) {
      toggle.checked = !toggle.checked;
      message.textContent = "Something went wrong — please try again.";
      message.classList.remove("hidden");
      console.error(err);
    } finally {
      toggle.disabled = false;
    }
  });
})();