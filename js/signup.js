const form = document.getElementById("signup-form");
const errorMessage = document.getElementById("signup-error-message");
const submitBtn = document.getElementById("signup-submit-btn");
const googleBtn = document.getElementById("google-signup-btn");
const formPanel = document.getElementById("signup-form-panel");
const confirmPanel = document.getElementById("signup-confirm-panel");
const confirmEmailEl = document.getElementById("signup-confirm-email");

// --- Google sign-up ---
// Redirects to login.html rather than handling the SIGNED_IN event here,
// so we reuse login.js's existing redirectAfterAuth logic: it already
// detects a brand-new Google user (no profile row yet) and sends them
// to onboarding.html. No need to duplicate that routing here.
googleBtn.addEventListener("click", async () => {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin + window.location.pathname.replace(/[^/]*$/, "") + "login.html"
    }
  });
  if (error) {
    errorMessage.textContent = window.t("signup.failed_prefix") + error.message;
    errorMessage.classList.remove("hidden");
  }
});

function showError(text) {
  errorMessage.textContent = text;
  errorMessage.classList.remove("hidden");
}

// --- Email/password sign-up ---
// Only creates the auth account + stores the preferred name for later —
// visa/arrival/region details are collected on onboarding.html, not here.
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorMessage.classList.add("hidden");

  const preferredName = document.getElementById("preferred_name").value.trim();
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  if (!preferredName) {
    showError(window.t("signup.name_required"));
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = window.t("signup.submitting");

  // emailRedirectTo points at login.html — after the person clicks the
  // confirmation link, they land there with an active session, and
  // login.js's redirectAfterAuth sends them on to onboarding.html since
  // no profile row exists for them yet.
  const { data, error } = await supabaseClient.auth.signUp({
    email: email,
    password: password,
    options: {
      emailRedirectTo: window.location.origin + window.location.pathname.replace(/[^/]*$/, "") + "login.html"
    }
  });

  submitBtn.disabled = false;
  submitBtn.textContent = window.t("signup.submit");

  if (error) {
    showError(window.t("signup.failed_prefix") + error.message);
    return;
  }

  // Held here until onboarding.html completes the actual profile insert —
  // there's no users row to attach it to until then.
  localStorage.setItem("se2l_preferred_name", preferredName);

  confirmEmailEl.textContent = email;
  formPanel.classList.add("hidden");
  confirmPanel.classList.remove("hidden");
});