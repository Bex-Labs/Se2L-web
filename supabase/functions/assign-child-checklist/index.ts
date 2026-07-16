// SE2L-29: assign child checklist items to a minor dependant based on age
//
// Single source of truth for "which checklist items apply to this minor" —
// called from onboarding.js when a minor is added at signup, and intended to
// be called by any future "add a dependant after signup" feature too, so the
// age-matching logic only ever lives in one place.
//
// Uses the service role key so this works regardless of which RLS-scoped
// context calls it (onboarding at signup has no dependants row to check
// ownership against yet in some flows, so keeping this server-side avoids
// having to reason about RLS timing here).
//
// Deploy with:
//   supabase functions deploy assign-child-checklist
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

function calculateAge(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
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

  let body: { dependantId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { dependantId } = body;
  if (!dependantId) {
    return new Response(JSON.stringify({ error: "Missing dependantId" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: dependant, error: dependantError } = await supabase
    .from("dependants")
    .select("id, type, date_of_birth")
    .eq("id", dependantId)
    .maybeSingle();

  if (dependantError || !dependant) {
    return new Response(JSON.stringify({ error: "Dependant not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // This checklist is minors-only — adults don't get child checklist items.
  // Not treated as an error: a caller might reasonably call this for every
  // newly-added dependant without checking type first, so just no-op.
  if (dependant.type !== "minor") {
    return new Response(JSON.stringify({ success: true, assigned: 0, skipped: "not a minor" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!dependant.date_of_birth) {
    return new Response(JSON.stringify({ success: true, assigned: 0, skipped: "no date_of_birth on file" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const age = calculateAge(dependant.date_of_birth);

  const { data: items, error: itemsError } = await supabase
    .from("child_checklist_items")
    .select("id, min_age, max_age");

  if (itemsError) {
    console.error("Failed to load checklist items:", itemsError.message);
    return new Response(JSON.stringify({ error: "Could not load checklist items" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const matchingItems = (items || []).filter((item) => {
    const meetsMin = item.min_age === null || age >= item.min_age;
    const meetsMax = item.max_age === null || age <= item.max_age;
    return meetsMin && meetsMax;
  });

  if (matchingItems.length === 0) {
    return new Response(JSON.stringify({ success: true, assigned: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rows = matchingItems.map((item) => ({
    dependant_id: dependantId,
    checklist_item_id: item.id,
    status: "pending",
  }));

  // Upsert rather than plain insert: if this ever gets called twice for the
  // same dependant (e.g. a retry), the unique(dependant_id, checklist_item_id)
  // constraint means a plain insert would fail on the second call. Upsert
  // makes this safely re-callable without erroring.
  const { error: insertError } = await supabase
    .from("dependant_checklist_state")
    .upsert(rows, { onConflict: "dependant_id,checklist_item_id", ignoreDuplicates: true });

  if (insertError) {
    console.error("Failed to assign checklist items:", insertError.message);
    return new Response(JSON.stringify({ error: "Could not assign checklist items" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true, assigned: rows.length }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});