// SE2L-46 (phase_activation) + scaffolding for SE2L-47/48/49
// (phase_end_warning / weekly_digest / milestone)
//
// This function reads PENDING rows from `notifications_queue` (written by
// notification-scheduler) and sends the actual email for each one via Resend.
//
// Kept as a separate function from notification-scheduler on purpose:
//   - Retries only need to re-scan notifications_queue, not re-run the full
//     arrival_date/phase detection logic for every user.
//   - RESEND_API_KEY is scoped to this function only; the scheduler never
//     needs it.
//   - Can be scheduled more frequently than the daily scan (e.g. every
//     15-30 min) to retry anything left "pending" or "failed" without
//     waiting for tomorrow's scheduler run.
//
// Deploy with:
//   supabase functions deploy send-queued-notifications
// Schedule via Supabase Cron Jobs (Dashboard -> Edge Functions -> Cron) or
// pg_cron, separately from notification-scheduler's daily job.
//
// Required secrets (already set):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, RESEND_FROM_EMAIL

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const resendApiKey = Deno.env.get("RESEND_API_KEY")!;
const resendFromEmail = Deno.env.get("RESEND_FROM_EMAIL")!;

const supabase = createClient(supabaseUrl, serviceRoleKey);

interface QueueRow {
  id: string;
  user_id: string;
  notification_type: string;
  phase_id: string | null;
  scheduled_for: string;
  status: string;
}

interface EmailContent {
  subject: string;
  html: string;
}

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: resendFromEmail, to, subject, html }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend API error ${res.status}: ${body}`);
  }
}

// --- SE2L-46: new phase activation ---
function phaseActivationEmail(phaseName: string): EmailContent {
  return {
    subject: `You've entered a new phase: ${phaseName}`,
    html: `
      <p>Hi there,</p>
      <p>Your Se2L journey has moved into a new phase: <strong>${phaseName}</strong>.</p>
      <p>Log in to see what's now unlocked and what to tackle next.</p>
      <p>— The Se2L team</p>
    `,
  };
}

// --- SE2L-47: phase-end warning (placeholder, to refine when we build this story) ---
function phaseEndWarningEmail(phaseName: string): EmailContent {
  return {
    subject: `Heads up: "${phaseName}" is wrapping up soon`,
    html: `
      <p>Hi there,</p>
      <p>Your <strong>${phaseName}</strong> phase window closes in a couple of days. Log in to make sure nothing's left outstanding.</p>
      <p>— The Se2L team</p>
    `,
  };
}

// --- SE2L-48: weekly digest (placeholder, to refine when we build this story) ---
function weeklyDigestEmail(): EmailContent {
  return {
    subject: `Your weekly Se2L digest`,
    html: `
      <p>Hi there,</p>
      <p>Here's your weekly check-in — log in to see your remaining tasks for this phase.</p>
      <p>— The Se2L team</p>
    `,
  };
}

// --- SE2L-49: milestone acknowledgement (placeholder, to refine when we build this story) ---
function milestoneEmail(): EmailContent {
  return {
    subject: `Nice work — you've hit a milestone!`,
    html: `
      <p>Hi there,</p>
      <p>You've completed another milestone in your Se2L journey. Keep it up!</p>
      <p>— The Se2L team</p>
    `,
  };
}

Deno.serve(async () => {
  const today = new Date().toISOString().split("T")[0];

  const { data: rows, error: queueError } = await supabase
    .from("notifications_queue")
    .select("id, user_id, notification_type, phase_id, scheduled_for, status")
    .eq("status", "pending")
    .lte("scheduled_for", today);

  if (queueError) {
    return new Response(
      JSON.stringify({ error: "Could not load notifications_queue", details: queueError.message }),
      { status: 500 }
    );
  }

  let sent = 0;
  let failed = 0;

  for (const row of (rows ?? []) as QueueRow[]) {
    try {
      const { data: user, error: userError } = await supabase
        .from("users")
        .select("email")
        .eq("id", row.user_id)
        .maybeSingle();

      if (userError || !user?.email) {
        throw new Error(userError?.message || "User has no email on file");
      }

      let phaseName = "your next phase";
      if (row.phase_id) {
        const { data: phase } = await supabase
          .from("phases")
          .select("name")
          .eq("id", row.phase_id)
          .maybeSingle();
        if (phase?.name) phaseName = phase.name;
      }

      let content: EmailContent;
      switch (row.notification_type) {
        case "phase_activation":
          content = phaseActivationEmail(phaseName);
          break;
        case "phase_end_warning":
          content = phaseEndWarningEmail(phaseName);
          break;
        case "weekly_digest":
          content = weeklyDigestEmail();
          break;
        case "milestone":
          content = milestoneEmail();
          break;
        default:
          throw new Error(`Unknown notification_type: ${row.notification_type}`);
      }

      await sendEmail(user.email, content.subject, content.html);

      await supabase
        .from("notifications_queue")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", row.id);

      sent++;
    } catch (err) {
      console.error(
        `Failed to send notification ${row.id} (${row.notification_type}):`,
        err instanceof Error ? err.message : err
      );

      await supabase
        .from("notifications_queue")
        .update({ status: "failed" })
        .eq("id", row.id);

      failed++;
    }
  }

  return new Response(
    JSON.stringify({ success: true, checked: rows?.length ?? 0, sent, failed }),
    { headers: { "Content-Type": "application/json" } }
  );
});