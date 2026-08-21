// SE2L-73: send App Manager invitation email
//
// Called directly from the browser (super-admin.js) right after the Super
// Admin inserts a row into app_manager_invites — same "fire immediately,
// not through notifications_queue" principle as send-dependant-invite,
// since an invite should go out the moment it's created.
//
// SE2L-77: the subject/body now come from email_templates (template_key =
// 'app_manager_invite') so a Super Admin can edit the copy without a
// redeploy. If that lookup fails for any reason, falls back to the
// original hardcoded copy below so this never breaks silently.
//
// Deploy with:
//   supabase functions deploy send-app-manager-invite
//
// Required secrets (already set):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, RESEND_FROM_EMAIL

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const resendApiKey = Deno.env.get("RESEND_API_KEY")!;
const resendFromEmail = Deno.env.get("RESEND_FROM_EMAIL")!;

const supabase = createClient(supabaseUrl, serviceRoleKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface InvitePayload {
  email: string;
  inviteToken: string;
  appOrigin: string; // e.g. "http://127.0.0.1:5500/se2l-web" or the deployed Vercel URL
}

const FALLBACK_SUBJECT = `You've been invited to manage content on Se2L`;
const FALLBACK_HTML = `
  <p>Hi,</p>
  <p>You've been invited to join Se2L as an App Manager — you'll be able to create and publish settlement guidance content for newcomers.</p>
  <p>To set up your account, click the link below:</p>
  <p><a href="{{invite_link}}">{{invite_link}}</a></p>
  <p>If you weren't expecting this invite, you can safely ignore this email.</p>
  <p>— The Se2L team</p>
`;

// Replaces every {{key}} placeholder with its value. Unknown placeholders
// are left as-is rather than silently blanked, so a typo in the admin's
// edited template is visible/debuggable instead of disappearing.
function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => (key in vars ? vars[key] : match));
}

async function getTemplate(): Promise<{ subject: string; html: string }> {
  const { data } = await supabase
    .from("email_templates")
    .select("subject, body_html")
    .eq("template_key", "app_manager_invite")
    .maybeSingle();

  return {
    subject: data?.subject || FALLBACK_SUBJECT,
    html: data?.body_html || FALLBACK_HTML,
  };
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

  // --- Verify the caller is a real, currently-authenticated super_admin ---
  // Previously missing entirely — anyone who found this function's URL
  // could trigger it with any email/token/appOrigin, using this trusted
  // domain to send arbitrarily-addressed invite-style emails. Same
  // verification pattern already used correctly in set-app-manager-active.
  const authHeader = req.headers.get("Authorization");
  const callerToken = authHeader?.replace("Bearer ", "");

  if (!callerToken) {
    return new Response(JSON.stringify({ error: "Missing authorization" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: { user: caller }, error: callerAuthError } = await supabase.auth.getUser(callerToken);

  if (callerAuthError || !caller) {
    return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: callerProfile } = await supabase
    .from("users")
    .select("role")
    .eq("id", caller.id)
    .maybeSingle();

  if (!callerProfile || callerProfile.role !== "super_admin") {
    return new Response(JSON.stringify({ error: "Only a super_admin can do this" }), {
      status: 403,
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

  const { subject: subjectTemplate, html: htmlTemplate } = await getTemplate();
  const vars = { invite_link: inviteLink };
  const subject = fillTemplate(subjectTemplate, vars);
  const html = fillTemplate(htmlTemplate, vars);

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