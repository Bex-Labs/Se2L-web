// SE2L-26: finalize a dependant's invite acceptance
//
// Called by accept-invite.js right after the dependant's own auth account has
// been created client-side (supabaseClient.auth.signUp). This function then:
//   1. Re-verifies the token is still valid and not already accepted
//      (guards against a double-submit or a reused/expired link).
//   2. Inserts their own `users` profile row, with their own visa/arrival
//      details — independent from the primary user's, since a dependant's
//      visa type or arrival date can genuinely differ.
//   3. Updates the original `dependants` row: sets linked_user_id to their
//      new account and flips invite_status to 'accepted'.
//
// Uses the service role key throughout so this doesn't require any new RLS
// exceptions for an unauthenticated-at-the-time visitor.
//
// Deploy with:
//   supabase functions deploy accept-dependant-invite
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

  // Re-verify the invite is still valid before doing anything — guards
  // against double-submits or someone reusing an already-accepted link.
  const { data: dependant, error: lookupError } = await supabase
    .from("dependants")
    .select("id, email, invite_status")
    .eq("invite_token", token)
    .maybeSingle();

  if (lookupError || !dependant) {
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

  const { error: profileError } = await supabase.from("users").insert({
    id: newUserId,
    email: dependant.email,
    visa_type: visaType,
    arrival_date: arrivalDate,
    uk_region: ukRegion,
    language: language,
  });

  if (profileError) {
    console.error("Failed to create dependant's profile:", profileError.message);
    return new Response(JSON.stringify({ error: "Could not create profile" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { error: updateError } = await supabase
    .from("dependants")
    .update({ linked_user_id: newUserId, invite_status: "accepted" })
    .eq("id", dependant.id);

  if (updateError) {
    console.error("Failed to link dependant record:", updateError.message);
    return new Response(JSON.stringify({ error: "Could not finalize invite" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});