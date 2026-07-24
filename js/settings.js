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

  if (profile?.role === "app_manager") {
    document.getElementById("app-manager-link")?.classList.remove("hidden");
  }
  if (profile?.role === "super_admin") {
    document.getElementById("super-admin-link")?.classList.remove("hidden");
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