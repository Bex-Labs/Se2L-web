// SE2L-73: send App Manager invitation email
//
// Called directly from the browser (super-admin.js) right after the Super
// Admin inserts a row into app_manager_invites — same "fire immediately,
// not through notifications_queue" principle as send-dependant-invite,
// since an invite should go out the moment it's created.
//
// Deploy with:
//   supabase functions deploy send-app-manager-invite
//
// Required secrets (already set):
//   RESEND_API_KEY, RESEND_FROM_EMAIL

const resendApiKey = Deno.env.get("RESEND_API_KEY")!;
const resendFromEmail = Deno.env.get("RESEND_FROM_EMAIL")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface InvitePayload {
  email: string;
  inviteToken: string;
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

  const { email, inviteToken, appOrigin } = payload;

  if (!email || !inviteToken || !appOrigin) {
    return new Response(
      JSON.stringify({ error: "Missing required fields: email, inviteToken, appOrigin" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const inviteLink = `${appOrigin}/accept-app-manager-invite.html?token=${inviteToken}`;

  const subject = `You've been invited to manage content on Se2L`;
  const html = `
    <p>Hi,</p>
    <p>You've been invited to join Se2L as an App Manager — you'll be able to create and publish settlement guidance content for newcomers.</p>
    <p>To set up your account, click the link below:</p>
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
    console.error("Failed to send app manager invite:", err instanceof Error ? err.message : err);
    return new Response(
      JSON.stringify({ error: "Failed to send invite email" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});