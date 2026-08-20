const form = document.getElementById("login-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const passwordField = document.getElementById("password-field");
const magicLinkToggle = document.getElementById("magic-link-toggle");
const magicLinkMessage = document.getElementById("magic-link-message");
const submitBtn = document.getElementById("login-submit-btn");
const googleBtn = document.getElementById("google-signin-btn");

// --- Shared-link context ---
// When task-detail.js redirects here because someone clicked a shared
// task link while logged out, explain why (rather than a silent bounce)
// and preserve the original destination so we can send them straight
// back after they authenticate, instead of dumping them on the dashboard.
const urlParams = new URLSearchParams(window.location.search);
const nextParam = urlParams.get("next");
const reasonParam = urlParams.get("reason");

if (reasonParam === "shared_task") {
  const sharedTaskMessage = document.getElementById("shared-task-message");
  if (sharedTaskMessage) {
    sharedTaskMessage.textContent = window.t("login.shared_task_message");
    sharedTaskMessage.classList.remove("hidden");
  }
}

// Carry the same destination through to signup, so someone who needs to
// create an account first still lands back on the shared task afterward
// rather than the default dashboard.
const registerLink = document.getElementById("register-link");
if (registerLink && nextParam) {
  registerLink.href = `signup.html?next=${encodeURIComponent(nextParam)}`;
}

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

  // An existing account that arrived here via a shared task link — send
  // them straight back to it instead of the dashboard, now that they're
  // authenticated. Only applies to people who already had an account;
  // brand-new sign-ups go through onboarding first (handled above/in
  // onboarding.js), same as any other new user.
  if (nextParam && !profileError) {
    window.location.href = decodeURIComponent(nextParam);
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