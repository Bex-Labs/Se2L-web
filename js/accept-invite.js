// SE2L-26: dependant accepts invite and completes their own intake

const heading = document.getElementById("invite-heading");
const subtext = document.getElementById("invite-subtext");
const errorBox = document.getElementById("invite-error");
const form = document.getElementById("accept-invite-form");
const emailInput = document.getElementById("dependant-email");

// Read the token from the URL, e.g. accept-invite.html?token=abc-123
const params = new URLSearchParams(window.location.search);
const token = params.get("token");

function showError() {
  subtext.textContent = "";
  errorBox.classList.remove("hidden");
  form.classList.add("hidden");
}

async function loadInvite() {
  if (!token) {
    showError();
    return;
  }

  try {
    const { data, error } = await supabaseClient.functions.invoke("get-dependant-invite", {
      body: { token }
    });

    if (error || !data || data.error) {
      showError();
      return;
    }

    heading.textContent = `Welcome, ${data.name}!`;
    subtext.textContent = "Complete a few details to set up your own Se2L account.";
    emailInput.value = data.email;
    form.classList.remove("hidden");
  } catch (err) {
    console.error("Failed to load invite:", err);
    showError();
  }
}

loadInvite();

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const password = document.getElementById("password").value;
  const visaType = document.getElementById("visa_type").value;
  const arrivalDate = document.getElementById("arrival_date").value;
  const ukRegion = document.getElementById("uk_region").value;
  const language = document.getElementById("language").value;
  const email = emailInput.value;

  // Step 1: create their own auth account, using the email from the invite.
  const { data, error } = await supabaseClient.auth.signUp({
    email: email,
    password: password
  });

  if (error) {
    alert("Account creation failed: " + error.message);
    return;
  }

  const newUserId = data.user.id;

  // Step 2: finalize via the Edge Function — creates their `users` profile
  // row and links the original dependant record back to this new account.
  const { data: acceptResult, error: acceptError } = await supabaseClient.functions.invoke(
    "accept-dependant-invite",
    {
      body: {
        token,
        newUserId,
        visaType,
        arrivalDate,
        ukRegion,
        language
      }
    }
  );

  if (acceptError || !acceptResult || acceptResult.error) {
    console.error("Failed to finalize invite:", acceptError || acceptResult?.error);
    alert("Your account was created, but we couldn't finish linking your invite. Please contact support.");
    return;
  }

  alert("Account created! Redirecting to your dashboard...");
  window.location.href = "dashboard.html";
});