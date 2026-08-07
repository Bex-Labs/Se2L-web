const form = document.getElementById("login-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const passwordField = document.getElementById("password-field");
const magicLinkToggle = document.getElementById("magic-link-toggle");
const magicLinkMessage = document.getElementById("magic-link-message");
const submitBtn = document.getElementById("login-submit-btn");
const googleBtn = document.getElementById("google-signin-btn");

// --- SE2L-79: Google OAuth ---
// redirectTo points back at this same page — the onAuthStateChange
// listener below (shared with the password/magic-link flows) picks up
// the resulting SIGNED_IN event and handles routing from there, same
// as it already does for magic link.
googleBtn.addEventListener("click", async () => {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin + window.location.pathname.replace(/[^/]*$/, "") + "login.html"
    }
  });
  if (error) {
    alert(window.t("login.failed_prefix") + error.message);
  }
});

let isMagicLinkMode = false;

// SE2L-80: toggling doesn't touch the password value, only whether it's
// required and visible — so switching back to password mode after a
// magic-link attempt doesn't lose anything the person already typed.
magicLinkToggle.addEventListener("click", () => {
  isMagicLinkMode = !isMagicLinkMode;
  passwordField.classList.toggle("hidden", isMagicLinkMode);
  passwordInput.required = !isMagicLinkMode;
  submitBtn.textContent = isMagicLinkMode
    ? window.t("login.magic_link_submit")
    : window.t("login.submit");
  magicLinkToggle.textContent = isMagicLinkMode
    ? window.t("login.use_password")
    : window.t("login.use_magic_link");
  magicLinkMessage.classList.add("hidden");
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = emailInput.value;

  if (isMagicLinkMode) {
    submitBtn.disabled = true;
    const { error } = await supabaseClient.auth.signInWithOtp({
      email: email,
      options: { emailRedirectTo: window.location.origin + window.location.pathname.replace(/[^/]*$/, "") + "login.html" }
    });
    submitBtn.disabled = false;

    if (error) {
      alert(window.t("login.failed_prefix") + error.message);
      return;
    }

    magicLinkMessage.textContent = window.t("login.magic_link_sent_prefix") + email;
    magicLinkMessage.classList.remove("hidden");
    return;
  }

  const password = passwordInput.value;
  const { error } = await supabaseClient.auth.signInWithPassword({
    email: email,
    password: password
  });

  if (error) {
    alert(window.t("login.failed_prefix") + error.message);
    return;
  }

  // Redirect happens in the onAuthStateChange listener below — shared
  // by both this password flow and the magic-link flow (which lands
  // back on this page with auth tokens in the URL, parsed automatically
  // by the Supabase client, which then fires this same SIGNED_IN event).
});

async function redirectAfterAuth(userId) {
  // Route App Managers and Super Admins to their own dashboards instead
  // of the regular newcomer dashboard.
  const { data: profile, error: profileError } = await supabaseClient
    .from("users")
    .select("role")
    .eq("id", userId)
    .single();

  // No profile row at all — this is a brand-new Google sign-up (OAuth
  // creates the auth account directly, bypassing onboarding.js's normal
  // signUp() + profile-insert flow). Send them to finish setting up
  // their profile rather than a dashboard with no visa/region data.
  if (profileError && profileError.code === "PGRST116") {
    window.location.href = "onboarding.html";
    return;
  }

  if (!profileError && profile?.role === "app_manager") {
    window.location.href = "app-manager.html";
    return;
  }

  if (!profileError && profile?.role === "super_admin") {
    window.location.href = "super-admin.html";
    return;
  }

  window.location.href = "dashboard.html";
}

supabaseClient.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_IN" && session?.user) {
    redirectAfterAuth(session.user.id);
  }
});