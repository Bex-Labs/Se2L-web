// SE2L-25: send adult dependant invitation email
//
// Unlike the scheduled notifications (SE2L-46-49), this fires immediately at
// signup time rather than through notifications_queue — an invite should go
// out the moment a household member is added, not wait for a cron cycle.
// onboarding.js calls this directly via fetch() right after inserting the
// dependant row.
//
// Deploy with:
//   supabase functions deploy send-dependant-invite
//
// Required secrets (already set):
//   RESEND_API_KEY, RESEND_FROM_EMAIL

const resendApiKey = Deno.env.get("RESEND_API_KEY")!;
const resendFromEmail = Deno.env.get("RESEND_FROM_EMAIL")!;

// This function is called directly from the browser (onboarding.js), unlike
// the scheduled functions which are only ever triggered server-side/from the
// dashboard. Browsers require these CORS headers before they'll allow a
// cross-origin call, plus an explicit response to the preflight OPTIONS
// request they send first.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface InvitePayload {
  email: string;
  inviteToken: string;
  dependantName: string;
  inviterName?: string;
  appOrigin: string; // e.g. "http://127.0.0.1:5500/se2l-web" or the deployed Vercel URL
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

Deno.serve(async (req) => {
  // Browsers send an OPTIONS preflight before the real POST — must respond
  // with the CORS headers or the actual request never gets sent.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let payload: InvitePayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { email, inviteToken, dependantName, inviterName, appOrigin } = payload;

  if (!email || !inviteToken || !dependantName || !appOrigin) {
    return new Response(
      JSON.stringify({ error: "Missing required fields: email, inviteToken, dependantName, appOrigin" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const inviteLink = `${appOrigin}/accept-invite.html?token=${inviteToken}`;
  const inviter = inviterName ? inviterName : "a family member";

  const subject = `You've been invited to join Se2L`;
  const html = `
    <p>Hi ${dependantName},</p>
    <p>${inviter} has added you as part of their household on Se2L, a settlement guidance platform for newcomers to the UK.</p>
    <p>To set up your own account and see your personalised checklist, click the link below:</p>
    <p><a href="${inviteLink}">${inviteLink}</a></p>
    <p>If you weren't expecting this invite, you can safely ignore this email.</p>
    <p>— The Se2L team</p>
  `;

  try {
    await sendEmail(email, subject, html);
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Failed to send dependant invite:", err instanceof Error ? err.message : err);
    return new Response(
      JSON.stringify({ error: "Failed to send invite email" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});