// SE2L-73: deactivate/reactivate an App Manager account
//
// Unlike an app-level "is_active" check sprinkled across every page, this
// bans the account at the Auth layer itself via the Admin API — enforcement
// happens before the person can even get a valid session, not after, so it
// can't be bypassed by calling Supabase directly instead of through the UI.
//
// Verifies the CALLER is a real, currently-logged-in super_admin before
// doing anything — this function wields real power (banning any account),
// so it re-checks identity server-side rather than trusting the client.
//
// Deploy with:
//   supabase functions deploy set-app-manager-active
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

// A very long ban rather than a permanent-ban primitive, since the Admin
// API's ban_duration takes a duration string, not an indefinite flag.
// ~100 years is the conventional way to express "effectively permanent."
const PERMANENT_BAN_DURATION = "876600h";

interface TogglePayload {
  targetUserId: string;
  isActive: boolean; // true = reactivate, false = deactivate
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

  // --- Parse and apply the request ---
  let payload: TogglePayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { targetUserId, isActive } = payload;

  if (!targetUserId || typeof isActive !== "boolean") {
    return new Response(
      JSON.stringify({ error: "Missing required fields: targetUserId, isActive" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (targetUserId === caller.id) {
    return new Response(
      JSON.stringify({ error: "You can't deactivate your own account." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { error: banError } = await supabase.auth.admin.updateUserById(targetUserId, {
    ban_duration: isActive ? "none" : PERMANENT_BAN_DURATION,
  });

  if (banError) {
    console.error("Failed to update ban status:", banError.message);
    return new Response(JSON.stringify({ error: "Could not update account status" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { error: profileUpdateError } = await supabase
    .from("users")
    .update({ is_active: isActive })
    .eq("id", targetUserId);

  if (profileUpdateError) {
    console.error("Account was banned/unbanned, but is_active flag failed to update:", profileUpdateError.message);
    return new Response(
      JSON.stringify({ error: "Status changed, but the display flag couldn't be updated. Refresh to check the real state." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});