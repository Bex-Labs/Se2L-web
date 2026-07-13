const form = document.getElementById("onboarding-form");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const visaType = document.getElementById("visa_type").value;
  const arrivalDate = document.getElementById("arrival_date").value;
  const ukRegion = document.getElementById("uk_region").value;
  const language = document.getElementById("language").value;

  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  const { data, error } = await supabaseClient.auth.signUp({
    email: email,
    password: password
  });

  if (error) {
    alert("Sign up failed: " + error.message);
    return;
  }

  const userId = data.user.id;

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
    alert("Profile creation failed: " + profileError.message);
    return;
  }

  alert("Journey created! Redirecting to your dashboard...");
  window.location.href = "dashboard.html";
});