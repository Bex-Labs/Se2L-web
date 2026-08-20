const form = document.getElementById("onboarding-form");
const welcomeHeading = document.getElementById("onboarding-welcome-heading");
const hasDependantsSelect = document.getElementById("has_dependants");

// By the time anyone reaches this page, an auth session must already
// exist — either from Google OAuth (redirected here by login.js after
// detecting no profile row) or from confirming their email after
// signing up on signup.html (same redirect path). There's no
// account-creation step here anymore.
let currentUser = null;
let preferredName = null;

(async function initSession() {
  const { data: { session } } = await supabaseClient.auth.getSession();

  if (!session?.user) {
    // No session at all — shouldn't normally happen, but bounce back
    // to signup rather than showing a broken form.
    window.location.href = "signup.html";
    return;
  }

  const { data: existingProfile } = await supabaseClient
    .from("users")
    .select("id")
    .eq("id", session.user.id)
    .maybeSingle();

  if (existingProfile) {
    // Already fully set up — nothing left to do here.
    window.location.href = "dashboard.html";
    return;
  }

  currentUser = session.user;

  // Preferred name comes from one of two places depending on signup path:
  // - Email/password: held in localStorage by signup.js since there was
  //   no users row to attach it to at that point.
  // - Google: Supabase's OAuth response already includes it in
  //   user_metadata, so there's nothing for the person to type here.
  preferredName = localStorage.getItem("se2l_preferred_name")
    || session.user.user_metadata?.full_name
    || session.user.user_metadata?.given_name
    || null;

  if (welcomeHeading && preferredName) {
    welcomeHeading.textContent = window.t("onboarding.welcome_heading_prefix") + preferredName + "!";
  }
})();

// --- SE2L-74: load active visa types and UK regions dynamically ---
async function loadVisaTypeAndRegionOptions() {
  const [visaTypesResult, regionsResult] = await Promise.all([
    supabaseClient.from("available_visa_types").select("value, label").eq("is_active", true).order("sort_order", { ascending: true }),
    supabaseClient.from("available_uk_regions").select("value, label").eq("is_active", true).order("sort_order", { ascending: true })
  ]);

  const visaTypeSelect = document.getElementById("visa_type");
  const regionSelect = document.getElementById("uk_region");

  if (visaTypesResult.data && visaTypesResult.data.length > 0) {
    visaTypeSelect.innerHTML = visaTypesResult.data.map(v => `<option value="${v.value}">${v.label}</option>`).join("");
  } else {
    visaTypeSelect.innerHTML = `<option value="">No visa types configured yet</option>`;
  }

  if (regionsResult.data && regionsResult.data.length > 0) {
    regionSelect.innerHTML = regionsResult.data.map(r => `<option value="${r.value}">${r.label}</option>`).join("");
  } else {
    regionSelect.innerHTML = `<option value="">No regions configured yet</option>`;
  }
}

loadVisaTypeAndRegionOptions();

// --- main submit handler ---
// Inserts the profile row (now including preferred_name), then routes
// to dependants.html if needed, or straight to the dashboard if not —
// dependants themselves are no longer collected on this page.
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const visaType = document.getElementById("visa_type").value;
  const arrivalDate = document.getElementById("arrival_date").value;
  const ukRegion = document.getElementById("uk_region").value;
  const language = document.getElementById("language").value;
  localStorage.setItem("se2l_language", language);

  const { error: profileError } = await supabaseClient
    .from("users")
    .insert({
      id: currentUser.id,
      email: currentUser.email,
      preferred_name: preferredName,
      visa_type: visaType,
      arrival_date: arrivalDate,
      uk_region: ukRegion,
      language: language
    });

  if (profileError) {
    alert(window.t("onboarding.profile_failed_prefix") + profileError.message);
    return;
  }

  // preferred_name has now been persisted to the users table — no need
  // to keep it in localStorage.
  localStorage.removeItem("se2l_preferred_name");

  if (hasDependantsSelect.value === "yes") {
    window.location.href = "dependants.html";
    return;
  }

  alert(window.t("onboarding.success_message"));
  window.location.href = "dashboard.html";
});