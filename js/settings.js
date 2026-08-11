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
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  const roleLabels = {
    app_manager: "App Manager",
    super_admin: "Super Admin"
  };

  const emailEl = document.getElementById("sidebar-user-email");
  const rolePillEl = document.getElementById("sidebar-role-pill");
  const avatarEl = document.getElementById("sidebar-identity-avatar");
  if (emailEl) emailEl.textContent = user.email || "Unknown user";
  if (rolePillEl) rolePillEl.textContent = roleLabels[profile?.role] || "Newcomer";
  if (avatarEl && user.email) {
    const namePart = user.email.split("@")[0];
    const initials = namePart.replace(/[^a-zA-Z]/g, " ").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
    avatarEl.textContent = initials || namePart.slice(0, 2).toUpperCase();
  }

  const backLink = document.getElementById("back-link");
  const dashboardNavLink = document.getElementById("dashboard-nav-link");

  if (profile?.role === "app_manager") {
    document.getElementById("app-manager-link")?.classList.remove("hidden");
    if (backLink) {
      backLink.href = "app-manager.html";
      backLink.textContent = "← Back to app manager dashboard";
    }
  } else if (profile?.role === "super_admin") {
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