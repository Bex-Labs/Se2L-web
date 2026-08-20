const form = document.getElementById("change-password-form");
const messageEl = document.getElementById("change-password-message");
const submitBtn = document.getElementById("change-password-btn");

// --- SE2L-83: language switcher ---
// Set the dropdown to whatever's currently active (from localStorage,
// via i18n.js) rather than always defaulting to English on page load.
const languageSwitcher = document.getElementById("language-switcher");
const languageMessage = document.getElementById("language-switch-message");

if (languageSwitcher) {
  const currentLang = localStorage.getItem("se2l_language") || "en";
  languageSwitcher.value = currentLang;

  languageSwitcher.addEventListener("change", async (e) => {
    const newLang = e.target.value;

    // Switches immediately (no reload needed) via the mechanism in i18n.js.
    window.se2lSetLanguage(newLang);

    // Also persist to the profile, so this preference is remembered
    // even if localStorage is ever cleared, and so it's available for
    // anything else that might want to read it server-side later
    // (e.g. deciding which language to send notification emails in).
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (user) {
      await supabaseClient.from("users").update({ language: newLang }).eq("id", user.id);
    }

    languageMessage.textContent = "Language updated.";
    languageMessage.classList.remove("hidden");
  });
}

// Populates the sidebar identity strip and shows the correct nav links
// for whoever is actually logged in — this page is reachable by any
// signed-in user, not just App Managers, so it can't assume a role.
async function loadSidebarIdentity() {
  const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
  if (authError || !user) return;

  const { data: profile } = await supabaseClient
    .from("users")
    .select("role, preferred_name")
    .eq("id", user.id)
    .maybeSingle();

  const roleLabels = {
    app_manager: "App Manager",
    super_admin: "Super Admin"
  };

  const displayName = profile?.preferred_name || user.email;

  const emailEl = document.getElementById("sidebar-user-email");
  const rolePillEl = document.getElementById("sidebar-role-pill");
  const avatarEl = document.getElementById("sidebar-identity-avatar");
  if (emailEl) emailEl.textContent = displayName || "Unknown user";
  if (rolePillEl) rolePillEl.textContent = roleLabels[profile?.role] || "Newcomer";
  if (avatarEl && displayName) {
    // Initials from the preferred name if set (e.g. "Sarah" -> "S"), or
    // from the email's local part as before for accounts without one.
    const namePart = profile?.preferred_name || user.email.split("@")[0];
    const initials = namePart.replace(/[^a-zA-Z]/g, " ").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
    avatarEl.textContent = initials || namePart.slice(0, 2).toUpperCase();
  }
  window.se2lCacheIdentity?.(displayName, roleLabels[profile?.role] || "Newcomer");

  const backLink = document.getElementById("back-link");
  const dashboardNavLink = document.getElementById("dashboard-nav-link");

  if (profile?.role === "app_manager") {
    document.getElementById("app-manager-link")?.classList.remove("hidden");
    if (backLink) {
      backLink.href = "app-manager.html";
      backLink.textContent = "← Back to app manager dashboard";
    }
  } else if (profile?.role === "super_admin") {
    document.getElementById("app-manager-link")?.classList.remove("hidden");
    document.getElementById("super-admin-link")?.classList.remove("hidden");
    if (backLink) {
      backLink.href = "super-admin.html";
      backLink.textContent = "← Back to platform overview";
    }
  } else {
    dashboardNavLink?.classList.remove("hidden");
  }
}

loadSidebarIdentity();

function showMessage(text, isError) {
  messageEl.textContent = text;
  messageEl.classList.remove("hidden", "text-red-600", "text-green-600");
  messageEl.classList.add(isError ? "text-red-600" : "text-green-600");
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const newPassword = document.getElementById("new_password").value;
  const confirmPassword = document.getElementById("confirm_password").value;

  if (newPassword !== confirmPassword) {
    showMessage("Passwords don't match. Please check and try again.", true);
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Updating...";

  const { error } = await supabaseClient.auth.updateUser({
    password: newPassword
  });

  submitBtn.disabled = false;
  submitBtn.textContent = "Update password";

  if (error) {
    showMessage("Couldn't update password: " + error.message, true);
    return;
  }

  showMessage("Password updated successfully.", false);
  form.reset();
});

// --- SE2L-95: editable journey details (visa type, arrival date, region) ---
// Lets a user correct/update the fields that drive their personalised
// roadmap, instead of these being fixed forever at signup. Also doubles
// as the fastest way to QA-test different visa/arrival scenarios without
// needing direct Supabase access.
//
// task_visa_types / task_uk_regions are junction tables (task_id + value),
// not option/definition tables, so the valid values are hardcoded here
// rather than queried. Update these two arrays if new visa types or
// regions are ever seeded (see SE2L-90 pattern for adding new journeys).
const VISA_TYPES = [
  { value: "skilled_worker", label: "Skilled Worker" },
  { value: "student", label: "Student" },
  { value: "graduate", label: "Graduate" },
  { value: "youth_mobility", label: "Youth Mobility" },
  { value: "bno", label: "BN(O)" },
  { value: "asylum_seeker", label: "Asylum Seeker" }
];

const UK_REGIONS = [
  { value: "england", label: "England" },
  { value: "scotland", label: "Scotland" },
  { value: "wales", label: "Wales" },
  { value: "northern_ireland", label: "Northern Ireland" }
];

const journeyForm = document.getElementById("journey-details-form");
const journeyMessageEl = document.getElementById("journey-details-message");
const journeySubmitBtn = document.getElementById("journey-details-btn");
const visaTypeSelect = document.getElementById("visa_type");
const arrivalDateInput = document.getElementById("arrival_date");
const ukRegionSelect = document.getElementById("uk_region");

function showJourneyMessage(text, isError) {
  journeyMessageEl.textContent = text;
  journeyMessageEl.classList.remove("hidden", "text-red-600", "text-green-600");
  journeyMessageEl.classList.add(isError ? "text-red-600" : "text-green-600");
}

// Tracks the values as loaded from the DB, so on submit we can tell
// whether anything actually changed — no need to warn/confirm if the
// user just clicked Save without touching any field.
let journeyOriginalValues = null;

async function initJourneyDetailsForm() {
  if (!journeyForm) return;

  visaTypeSelect.innerHTML = VISA_TYPES
    .map(v => `<option value="${v.value}">${v.label}</option>`)
    .join("");

  ukRegionSelect.innerHTML = UK_REGIONS
    .map(r => `<option value="${r.value}">${r.label}</option>`)
    .join("");

  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  const { data: profile } = await supabaseClient
    .from("users")
    .select("visa_type, arrival_date, uk_region")
    .eq("id", user.id)
    .maybeSingle();

  if (profile) {
    if (profile.visa_type) visaTypeSelect.value = profile.visa_type;
    if (profile.arrival_date) arrivalDateInput.value = profile.arrival_date;
    if (profile.uk_region) ukRegionSelect.value = profile.uk_region;
  }

  journeyOriginalValues = {
    visa_type: visaTypeSelect.value,
    arrival_date: arrivalDateInput.value,
    uk_region: ukRegionSelect.value
  };
}

initJourneyDetailsForm();

if (journeyForm) {
  journeyForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const newValues = {
      visa_type: visaTypeSelect.value,
      arrival_date: arrivalDateInput.value,
      uk_region: ukRegionSelect.value
    };

    const hasChanged = !journeyOriginalValues ||
      newValues.visa_type !== journeyOriginalValues.visa_type ||
      newValues.arrival_date !== journeyOriginalValues.arrival_date ||
      newValues.uk_region !== journeyOriginalValues.uk_region;

    // SE2L-95: warn before committing a change that affects visa type,
    // arrival date, or region — these drive which "journey" (phases/tasks)
    // the dashboard shows. Nothing already completed is ever deleted
    // (user_task_state rows persist regardless), but the roadmap can
    // reshuffle to a different task set and the progress bar can appear
    // to drop, since it's calculated against whatever task list currently
    // matches the profile. Only prompted when something actually changed.
    if (hasChanged) {
      const confirmed = window.confirm(
        "Changing your visa type, arrival date, or region will update your roadmap and may show a different set of tasks. " +
        "Progress on tasks that still apply will be kept, but your roadmap may look different afterwards.\n\n" +
        "Continue?"
      );
      if (!confirmed) return;
    }

    journeySubmitBtn.disabled = true;
    journeySubmitBtn.textContent = "Saving...";

    const { data: { user } } = await supabaseClient.auth.getUser();

    const { error } = await supabaseClient
      .from("users")
      .update(newValues)
      .eq("id", user.id);

    journeySubmitBtn.disabled = false;
    journeySubmitBtn.textContent = "Save journey details";

    if (error) {
      showJourneyMessage("Couldn't save journey details: " + error.message, true);
      return;
    }

    journeyOriginalValues = newValues;
    // Re-lock region after a successful save — a fresh "Change region"
    // click is required again for any future change, same deliberate
    // gate as the first time.
    ukRegionSelect.disabled = true;
    showJourneyMessage("Journey details updated. Your roadmap will reflect this on next visit to the dashboard.", false);
  });
}

// --- SE2L-95 follow-up: region change gated behind an explicit confirm ---
// Region defaults to locked (disabled) in the HTML. Unlike visa type or
// arrival date, a real region change usually means a physical move —
// rarer and more disruptive to the roadmap — so it gets its own
// deliberate confirmation step before the field even becomes editable,
// on top of the general save-time warning that still applies to all
// three fields together.
const changeRegionLink = document.getElementById("change-region-link");
const changeRegionModal = document.getElementById("change-region-modal");

changeRegionLink?.addEventListener("click", () => {
  if (changeRegionModal) changeRegionModal.style.display = "flex";
});

document.getElementById("change-region-cancel")?.addEventListener("click", () => {
  if (changeRegionModal) changeRegionModal.style.display = "none";
});

changeRegionModal?.addEventListener("click", (e) => {
  if (e.target.id === "change-region-modal") changeRegionModal.style.display = "none";
});

document.getElementById("change-region-confirm")?.addEventListener("click", () => {
  if (changeRegionModal) changeRegionModal.style.display = "none";
  ukRegionSelect.disabled = false;
  ukRegionSelect.focus();
});

// --- Household members list ---
// Queries family_dependants_view (same as dashboard.js's loadFamilySection)
// rather than the raw dependants table, since that view already excludes
// fields that shouldn't be exposed and enforces the same access boundary.
async function loadHouseholdMembersList() {
  const listEl = document.getElementById("household-members-list");
  if (!listEl) return;

  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  const { data: dependants, error } = await supabaseClient
    .from("family_dependants_view")
    .select("*")
    .eq("primary_user_id", user.id);

  if (error) {
    listEl.innerHTML = `<p class="text-sm text-red-600">Couldn't load household members.</p>`;
    return;
  }

  if (!dependants || dependants.length === 0) {
    listEl.innerHTML = `<p class="text-sm text-slate-400">No household members added yet.</p>`;
    return;
  }

  const statusLabel = {
    pending: "Invite sent",
    accepted: "Account set up"
  };

  listEl.innerHTML = dependants.map(d => {
    const relationshipLabel = d.relationship || (d.type === "minor" ? "Child" : "Adult");
    const subLabel = d.type === "adult"
      ? (statusLabel[d.invite_status] || "—")
      : "Child";
    return `
      <div class="flex items-center justify-between" style="padding: 0.5rem 0; border-bottom: 1px solid var(--color-border);">
        <div>
          <p class="text-sm font-medium">${d.name}</p>
          <p class="text-xs text-slate-500">${relationshipLabel} · ${subLabel}</p>
        </div>
      </div>
    `;
  }).join("");
}

loadHouseholdMembersList();