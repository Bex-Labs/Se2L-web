// SE2L-26: look up a pending dependant invite by token
//
// Called by accept-invite.js before the dependant has an account, so this
// can't go through normal RLS-scoped client queries. Uses the service role
// key to look up strictly by invite_token, and only returns the minimal
// fields the acceptance page needs (name + email) — never the full row.
//
// Deploy with:
//   supabase functions deploy get-dependant-invite
//
// Required secrets (already set): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, serviceRoleKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { token } = body;
  if (!token) {
    return new Response(JSON.stringify({ error: "Missing token" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: dependant, error } = await supabase
    .from("dependants")
    .select("name, email, invite_status")
    .eq("invite_token", token)
    .maybeSingle();

  if (error || !dependant) {
    return new Response(JSON.stringify({ error: "Invite not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (dependant.invite_status === "accepted") {
    return new Response(JSON.stringify({ error: "This invite has already been used" }), {
      status: 409,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ name: dependant.name, email: dependant.email }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});