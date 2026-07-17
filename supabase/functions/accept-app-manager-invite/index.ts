// SE2L-73: finalize an App Manager invite acceptance
//
// Called by accept-app-manager-invite.js right after the invitee's own auth
// account has been created client-side (supabaseClient.auth.signUp). This
// function then:
//   1. Re-verifies the token is still valid and not already accepted
//      (guards against a double-submit or a reused/expired link).
//   2. Inserts their `users` profile row with role = 'app_manager' and
//      is_active = true, reusing the same visa_type/arrival_date/uk_region/
//      language fields every account already has — no schema forking for
//      staff vs newcomers.
//   3. Marks the invite row as accepted.
//
// Uses the service role key throughout, same as accept-dependant-invite.
//
// Deploy with:
//   supabase functions deploy accept-app-manager-invite
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

interface AcceptPayload {
  token: string;
  newUserId: string;
  visaType: string;
  arrivalDate: string;
  ukRegion: string;
  language: string;
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

  let payload: AcceptPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { token, newUserId, visaType, arrivalDate, ukRegion, language } = payload;

  if (!token || !newUserId || !visaType || !arrivalDate || !ukRegion || !language) {
    return new Response(JSON.stringify({ error: "Missing required fields" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: invite, error: lookupError } = await supabase
    .from("app_manager_invites")
    .select("id, email, status")
    .eq("invite_token", token)
    .maybeSingle();

  if (lookupError || !invite) {
    return new Response(JSON.stringify({ error: "Invite not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (invite.status === "accepted") {
    return new Response(JSON.stringify({ error: "This invite has already been used" }), {
      status: 409,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { error: profileError } = await supabase.from("users").insert({
    id: newUserId,
    email: invite.email,
    visa_type: visaType,
    arrival_date: arrivalDate,
    uk_region: ukRegion,
    language: language,
    role: "app_manager",
    is_active: true,
  });

  if (profileError) {
    console.error("Failed to create app manager profile:", profileError.message);
    return new Response(JSON.stringify({ error: "Could not create profile" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { error: updateError } = await supabase
    .from("app_manager_invites")
    .update({ status: "accepted" })
    .eq("id", invite.id);

  if (updateError) {
    console.error("Failed to mark invite accepted:", updateError.message);
    return new Response(JSON.stringify({ error: "Could not finalize invite" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});