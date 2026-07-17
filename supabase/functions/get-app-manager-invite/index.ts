// SE2L-73: look up an App Manager invite by token
//
// Called by accept-app-manager-invite.js when the invite page first loads,
// before the visitor has any account or session. Uses the service role so
// this works for a completely unauthenticated visitor, without needing a
// public RLS exception on app_manager_invites.
//
// Deploy with:
//   supabase functions deploy get-app-manager-invite
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

interface LookupPayload {
  token: string;
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

  let payload: LookupPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { token } = payload;

  if (!token) {
    return new Response(JSON.stringify({ error: "Missing token" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: invite, error } = await supabase
    .from("app_manager_invites")
    .select("email, status")
    .eq("invite_token", token)
    .maybeSingle();

  if (error || !invite || invite.status === "accepted") {
    return new Response(JSON.stringify({ error: "Invite not found or already used" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ email: invite.email }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});