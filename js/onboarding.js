const form = document.getElementById("onboarding-form");

// --- SE2L-79: Google OAuth support ---
// A brand-new Google sign-up lands here already authenticated (from
// login.js's redirect), but has no row in `users` yet — signUp() never
// ran for them, since OAuth creates the auth account directly. Detect
// that case and switch the page into "complete your profile" mode:
// skip account creation entirely, just collect the same visa/region/
// household fields and attach them to the existing session's user.
let isProfileCompletionMode = false;
let existingSessionUser = null;

(async function checkForExistingSession() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session?.user) return;

  const { data: existingProfile } = await supabaseClient
    .from("users")
    .select("id")
    .eq("id", session.user.id)
    .maybeSingle();

  if (existingProfile) {
    // Already fully set up — nothing to do here.
    window.location.href = "dashboard.html";
    return;
  }

  isProfileCompletionMode = true;
  existingSessionUser = session.user;

  // Hide account-creation fields — this person already has an account.
  document.getElementById("email").closest(".form-field")?.classList.add("hidden");
  document.getElementById("password").closest(".form-field")?.classList.add("hidden");
  document.getElementById("email").required = false;
  document.getElementById("password").required = false;

  const heading = document.querySelector('[data-i18n="onboarding.heading"]');
  const subtext = document.querySelector('[data-i18n="onboarding.subtext"]');
  if (heading) heading.textContent = window.t("onboarding.complete_profile_heading");
  if (subtext) subtext.textContent = window.t("onboarding.complete_profile_subtext");

  const submitBtn = document.querySelector('#onboarding-form button[type="submit"]');
  if (submitBtn) submitBtn.textContent = window.t("onboarding.complete_profile_submit");
})();

// --- SE2L-74: load active visa types and UK regions dynamically ---
// Readable by anyone (including this pre-signup page) since these tables'
// RLS policies grant SELECT to public — only Super Admin can write to them.
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

// --- SE2L-23: household members section ---
const hasDependantsSelect = document.getElementById("has_dependants");
const dependantsSection = document.getElementById("dependants-section");
const dependantsContainer = document.getElementById("dependants-container");
const addDependantBtn = document.getElementById("add-dependant-btn");
const dependantTemplate = document.getElementById("dependant-entry-template");

// Show/hide the household members section based on the has_dependants answer.
hasDependantsSelect.addEventListener("change", () => {
  if (hasDependantsSelect.value === "yes") {
    dependantsSection.classList.remove("hidden");
    // Add one entry by default so the user isn't staring at an empty section.
    if (dependantsContainer.children.length === 0) {
      addDependantEntry();
    }
  } else {
    dependantsSection.classList.add("hidden");
  }
});

function addDependantEntry() {
  const clone = dependantTemplate.content.cloneNode(true);
  dependantsContainer.appendChild(clone);
  // The cloned entry didn't exist when i18n.js ran its initial pass on
  // page load, so translate it now — safe to re-run on the whole
  // container each time, since it's idempotent for already-translated entries.
  if (window.se2lTranslateElement) {
    window.se2lTranslateElement(dependantsContainer);
  }
}

addDependantBtn.addEventListener("click", addDependantEntry);

// Event delegation: toggle the email field per-row based on that row's relationship type,
// and handle the remove button, since rows are added/removed dynamically.
dependantsContainer.addEventListener("change", (e) => {
  if (e.target.classList.contains("dependant-type")) {
    const entry = e.target.closest(".dependant-entry");
    const emailWrapper = entry.querySelector(".dependant-email-wrapper");
    if (e.target.value === "adult") {
      emailWrapper.classList.remove("hidden");
    } else {
      emailWrapper.classList.add("hidden");
      entry.querySelector(".dependant-email").value = "";
    }
  }
});

dependantsContainer.addEventListener("click", (e) => {
  if (e.target.classList.contains("remove-dependant-btn")) {
    e.target.closest(".dependant-entry").remove();
  }
});

function collectDependants() {
  const entries = dependantsContainer.querySelectorAll(".dependant-entry");
  const dependants = [];

  for (const entry of entries) {
    const name = entry.querySelector(".dependant-name").value.trim();
    const dob = entry.querySelector(".dependant-dob").value;
    const type = entry.querySelector(".dependant-type").value;
    const relationship = entry.querySelector(".dependant-relationship").value.trim();
    const email = entry.querySelector(".dependant-email").value.trim();

    if (!name) continue; // skip empty rows rather than blocking submission

    dependants.push({
      name,
      date_of_birth: dob || null,
      type,
      relationship: relationship || null,
      // Only adults carry an email/invite — children don't get their own account.
      email: type === "adult" && email ? email : null
    });
  }

  return dependants;
}

// --- main submit handler ---
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const visaType = document.getElementById("visa_type").value;
  const arrivalDate = document.getElementById("arrival_date").value;
  const ukRegion = document.getElementById("uk_region").value;
  const language = document.getElementById("language").value;
  localStorage.setItem("se2l_language", language);

  let userId, email;

  if (isProfileCompletionMode) {
    // Already authenticated via Google — no account to create, just
    // attach this profile data to the session that's already there.
    userId = existingSessionUser.id;
    email = existingSessionUser.email;
  } else {
    const password = document.getElementById("password").value;
    email = document.getElementById("email").value;

    const { data, error } = await supabaseClient.auth.signUp({
      email: email,
      password: password
    });

    if (error) {
      alert(window.t("onboarding.signup_failed_prefix") + error.message);
      return;
    }

    userId = data.user.id;
  }

  const { error: profileError } = await supabaseClient
    .from("users")
    .insert({
      id: userId,
      email: email,
      visa_type: visaType,
      arrival_date: arrivalDate,
      uk_region: ukRegion,
      language: language
    });

  if (profileError) {
    alert(window.t("onboarding.profile_failed_prefix") + profileError.message);
    return;
  }

  // --- SE2L-23: insert household members now that primary_user_id exists ---
  if (hasDependantsSelect.value === "yes") {
    const dependants = collectDependants();

    if (dependants.length > 0) {
      const rows = dependants.map((d) => ({
        id: crypto.randomUUID(),
        primary_user_id: userId,
        type: d.type,
        name: d.name,
        date_of_birth: d.date_of_birth,
        relationship: d.relationship,
        email: d.email,
        // Adults with an email get an invite token now; SE2L-25 sends the actual
        // invite email using this token. Children have no invite flow.
        invite_status: d.email ? "pending" : null,
        invite_token: d.email ? crypto.randomUUID() : null
      }));

      const { error: dependantsError } = await supabaseClient
        .from("dependants")
        .insert(rows);

      if (dependantsError) {
        // Don't block the whole signup over this — the account and journey are
        // already created successfully at this point. Surface it and move on.
        console.error("Failed to save household members:", dependantsError.message);
        alert(window.t("onboarding.dependants_save_failed"));
        window.location.href = "dashboard.html";
        return;
      }

      // --- SE2L-25: send invite emails to adult dependants ---
      // Fires immediately rather than through notifications_queue, since an
      // invite should go out the moment someone's added, not on a schedule.
      const adultInvites = rows.filter((r) => r.type === "adult" && r.email);

      for (const invite of adultInvites) {
        const { error: inviteError } = await supabaseClient.functions.invoke(
          "send-dependant-invite",
          {
            body: {
              email: invite.email,
              inviteToken: invite.invite_token,
              dependantName: invite.name,
              appOrigin: window.location.origin + window.location.pathname.replace(/\/[^/]*$/, "")
            }
          }
        );

        if (inviteError) {
          // Same principle as above: the dependant row already exists, so this
          // isn't fatal — just log it so it's visible for troubleshooting.
          console.error(`Failed to send invite to ${invite.email}:`, inviteError.message);
        }
      }

      // --- SE2L-29: assign checklist items to minor dependants ---
      // Single source of truth for the age-matching logic lives in the
      // assign-child-checklist function, so this stays a thin call rather
      // than duplicating age-matching logic here.
      const minors = rows.filter((r) => r.type === "minor");

      for (const minor of minors) {
        const { error: checklistError } = await supabaseClient.functions.invoke(
          "assign-child-checklist",
          { body: { dependantId: minor.id } }
        );

        if (checklistError) {
          // Not fatal — the dependant record itself is already saved.
          console.error(`Failed to assign checklist for ${minor.name}:`, checklistError.message);
        }
      }
    }
  }

  alert(window.t("onboarding.success_message"));
  window.location.href = "dashboard.html";
});