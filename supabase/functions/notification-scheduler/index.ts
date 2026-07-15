// SE2L-50: arrival_date-relative notification scheduler
//
// This is a Supabase Edge Function meant to run on a daily cron schedule.
// It does NOT send emails itself — it only figures out which notifications
// are due today and inserts rows into `notifications_queue`. The actual
// sending (SE2L-46 through SE2L-49) is a separate function that reads from
// this queue, so the "figuring out what's due" logic stays independent from
// "how emails actually get sent" (which email provider, templates, etc.).
//
// Deploy with:
//   supabase functions deploy notification-scheduler
// Schedule it (once per day) with either:
//   - Supabase's built-in Cron Jobs (Dashboard -> Edge Functions -> Cron), or
//   - pg_cron calling this function's URL via `net.http_post` on a schedule.
//
// Required environment variables (set as Supabase secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// The service role key is required because this function needs to read
// every user's data and write to notifications_queue, bypassing RLS.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, serviceRoleKey);

function daysBetween(a: Date, b: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((b.getTime() - a.getTime()) / msPerDay);
}

async function alreadyQueued(userId: string, notificationType: string, scheduledFor: string, phaseId: string | null) {
  const { data } = await supabase
    .from("notifications_queue")
    .select("id")
    .eq("user_id", userId)
    .eq("notification_type", notificationType)
    .eq("scheduled_for", scheduledFor)
    .eq("phase_id", phaseId)
    .maybeSingle();
  return !!data;
}

async function queueNotification(userId: string, notificationType: string, phaseId: string | null, scheduledFor: string) {
  const already = await alreadyQueued(userId, notificationType, scheduledFor, phaseId);
  if (already) return; // avoid duplicate queue entries if the scheduler runs more than once on the same day

  const { error } = await supabase.from("notifications_queue").insert({
    user_id: userId,
    notification_type: notificationType,
    phase_id: phaseId,
    scheduled_for: scheduledFor,
    status: "pending"
  });

  if (error) console.error(`Failed to queue ${notificationType} for user ${userId}:`, error.message);
}

Deno.serve(async () => {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  const { data: users, error: usersError } = await supabase
    .from("users")
    .select("id, arrival_date, visa_type, uk_region");

  if (usersError || !users) {
    return new Response(JSON.stringify({ error: "Could not load users" }), { status: 500 });
  }

  let queuedCount = 0;

  for (const user of users) {
    if (!user.arrival_date) continue;

    const arrival = new Date(user.arrival_date);
    const daysSinceArrival = daysBetween(arrival, today);

    // --- SE2L-46: new phase activation ---
    // Fires the day a user's current phase changes, by checking if today
    // is exactly the start day of any phase in their journey.
    const { data: journey } = await supabase
      .from("journeys")
      .select("id")
      .eq("visa_type", user.visa_type)
      .eq("uk_region", user.uk_region)
      .maybeSingle();

    if (journey) {
      const { data: phases } = await supabase
        .from("phases")
        .select("*")
        .eq("journey_id", journey.id)
        .order("sort_order", { ascending: true });

      if (phases) {
        for (const phase of phases) {
          // Phase activation: today is the first day of this phase's window
          if (daysSinceArrival === phase.days_after_arrival_start) {
            await queueNotification(user.id, "phase_activation", phase.id, todayStr);
            queuedCount++;
          }

          // --- SE2L-47: phase-end warning ---
          // Fires 2 days before a phase's window closes, so the user has a
          // heads-up while there's still time to act.
          if (daysSinceArrival === phase.days_after_arrival_end - 2) {
            await queueNotification(user.id, "phase_end_warning", phase.id, todayStr);
            queuedCount++;
          }
        }
      }
    }

    // --- SE2L-48: weekly digest ---
    // Fires every 7 days since arrival (day 7, 14, 21, ...), regardless of
    // phase boundaries — a steady heartbeat notification.
    if (daysSinceArrival > 0 && daysSinceArrival % 7 === 0) {
      await queueNotification(user.id, "weekly_digest", null, todayStr);
      queuedCount++;
    }

    // --- SE2L-49: milestone acknowledgement ---
    // Fires when a user crosses a round-number completion milestone. This
    // scheduler checks completed task counts; the actual "which milestone
    // copy to send" decision happens in the email-sending function.
    const { count: completedCount } = await supabase
      .from("user_task_state")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "complete");

    const milestones = [1, 5, 10, 25];
    if (completedCount !== null && milestones.includes(completedCount)) {
      // scheduled_for = today by definition here, since it's triggered by an event, not a date
      await queueNotification(user.id, "milestone", null, todayStr);
      queuedCount++;
    }
  }

  return new Response(
    JSON.stringify({ success: true, usersChecked: users.length, notificationsQueued: queuedCount }),
    { headers: { "Content-Type": "application/json" } }
  );
});