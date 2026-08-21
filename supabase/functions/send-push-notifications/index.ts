// SE2L-91: push notifications
//
// Reads rows from `notifications_queue` where push_status = 'pending' —
// the SAME queue send-queued-notifications reads for email — so push
// notifications fire from the exact same trigger events (phase
// activation, phase-end warning, weekly digest, milestone) without
// needing a second scheduling system. Kept as a separate function from
// send-queued-notifications on purpose, same rationale documented
// there: independent retry cadence, and PUSH_VAPID_PRIVATE_KEY is
// scoped to this function only.
//
// A user with no push_subscriptions rows (the common case until they
// opt in from settings.html) gets push_status set to 'skipped', not
// 'failed' — this isn't an error, they just haven't subscribed.
//
// Deploy with:
//   supabase functions deploy send-push-notifications
// Schedule via Supabase Cron Jobs, same as send-queued-notifications.
//
// Required secrets (set these before first deploy):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   PUSH_VAPID_PUBLIC_KEY, PUSH_VAPID_PRIVATE_KEY, PUSH_VAPID_SUBJECT
//   (PUSH_VAPID_SUBJECT is a mailto: address or URL identifying this
//   app to push services — e.g. "mailto:support@se2l.app")

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const vapidPublicKey = Deno.env.get("PUSH_VAPID_PUBLIC_KEY")!;
const vapidPrivateKey = Deno.env.get("PUSH_VAPID_PRIVATE_KEY")!;
const vapidSubject = Deno.env.get("PUSH_VAPID_SUBJECT")!;

const supabase = createClient(supabaseUrl, serviceRoleKey);

webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

interface QueueRow {
  id: string;
  user_id: string;
  notification_type: string;
  phase_id: string | null;
}

interface PushContent {
  title: string;
  body: string;
}

// Short, notification-appropriate copy — deliberately condensed
// compared to the full email templates (a push notification has very
// little room), and always links back to the dashboard on click.
const PUSH_CONTENT: Record<string, PushContent> = {
  phase_activation: {
    title: "A new phase just started",
    body: "Your settlement checklist has new tasks ready for you.",
  },
  phase_end_warning: {
    title: "This phase is wrapping up soon",
    body: "Check your dashboard for anything still outstanding.",
  },
  weekly_digest: {
    title: "Your weekly progress",
    body: "See what you've completed and what's next.",
  },
  milestone: {
    title: "Nice work — milestone reached",
    body: "Open Se2L to see your progress.",
  },
};

Deno.serve(async (req) => {
  // --- Verify this is a genuine cron trigger, not a public request ---
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && req.headers.get("x-cron-secret") !== cronSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const { data: rows, error } = await supabase
    .from("notifications_queue")
    .select("id, user_id, notification_type, phase_id")
    .eq("push_status", "pending")
    .limit(200);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  if (!rows || rows.length === 0) {
    return new Response(JSON.stringify({ sent: 0, skipped: 0, failed: 0 }), { status: 200 });
  }

  let sent = 0, skipped = 0, failed = 0;

  for (const row of rows as QueueRow[]) {
    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", row.user_id);

    if (!subs || subs.length === 0) {
      // Not an error — this user just hasn't enabled push notifications.
      await supabase.from("notifications_queue").update({ push_status: "skipped" }).eq("id", row.id);
      skipped++;
      continue;
    }

    const content = PUSH_CONTENT[row.notification_type] || PUSH_CONTENT.phase_activation;
    const payload = JSON.stringify({
      title: content.title,
      body: content.body,
      url: "dashboard.html",
    });

    let anySucceeded = false;

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload
        );
        anySucceeded = true;
      } catch (err) {
        // A 404/410 from the push service means this specific
        // subscription is dead (browser uninstalled, permission
        // revoked, etc.) — clean it up rather than retrying it forever.
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        }
      }
    }

    await supabase
      .from("notifications_queue")
      .update({ push_status: anySucceeded ? "sent" : "failed" })
      .eq("id", row.id);

    if (anySucceeded) sent++; else failed++;
  }

  return new Response(JSON.stringify({ sent, skipped, failed }), { status: 200 });
});