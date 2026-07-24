const form = document.getElementById("change-password-form");
const messageEl = document.getElementById("change-password-message");
const submitBtn = document.getElementById("change-password-btn");

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
  if (emailEl) emailEl.textContent = user.email || "Unknown user";
  if (rolePillEl) rolePillEl.textContent = roleLabels[profile?.role] || "Newcomer";

  const backLink = document.getElementById("back-link");
  const dashboardNavLink = document.getElementById("dashboard-nav-link");

  if (profile?.role === "app_manager") {
    document.getElementById("app-manager-link")?.classList.remove("hidden");
    dashboardNavLink?.classList.add("hidden");
    if (backLink) {
      backLink.href = "app-manager.html";
      backLink.textContent = "← Back to app manager dashboard";
    }
  } else if (profile?.role === "super_admin") {
    document.getElementById("super-admin-link")?.classList.remove("hidden");
    dashboardNavLink?.classList.add("hidden");
    if (backLink) {
      backLink.href = "super-admin.html";
      backLink.textContent = "← Back to platform overview";
    }
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