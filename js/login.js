const form = document.getElementById("login-form");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email: email,
    password: password
  });

  if (error) {
    alert("Log in failed: " + error.message);
    return;
  }

  // Route App Managers straight to their dashboard instead of the
  // regular newcomer dashboard.
  const { data: profile, error: profileError } = await supabaseClient
    .from("users")
    .select("role")
    .eq("id", data.user.id)
    .single();

  if (!profileError && profile?.role === "app_manager") {
    window.location.href = "app-manager.html";
    return;
  }

  window.location.href = "dashboard.html";
});