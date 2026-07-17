// SE2L-73: App Manager accepts invite and completes account setup

const subtext = document.getElementById("invite-subtext");
const errorBox = document.getElementById("invite-error");
const form = document.getElementById("accept-invite-form");
const emailInput = document.getElementById("invite-email");

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
    const { data, error } = await supabaseClient.functions.invoke("get-app-manager-invite", {
      body: { token }
    });

    if (error || !data || data.error) {
      showError();
      return;
    }

    subtext.textContent = "Complete a few details to set up your App Manager account.";
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

  const { data, error } = await supabaseClient.auth.signUp({
    email: email,
    password: password
  });

  if (error) {
    alert("Account creation failed: " + error.message);
    return;
  }

  const newUserId = data.user.id;

  const { data: acceptResult, error: acceptError } = await supabaseClient.functions.invoke(
    "accept-app-manager-invite",
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
    alert("Your account was created, but we couldn't finish setting up App Manager access. Please contact your Super Admin.");
    return;
  }

  alert("Account created! Redirecting to the App Manager dashboard...");
  window.location.href = "app-manager.html";
});