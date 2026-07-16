const form = document.getElementById("onboarding-form");

// --- SE2L-23: household members section ---
const hasDependantsSelect = document.getElementById("has_dependants");
const dependantsSection = document.getElementById("dependants-section");
const dependantsContainer = document.getElementById("dependants-container");
const addDependantBtn = document.getElementById("add-dependant-btn");
const dependantTemplate = document.getElementById("dependant-entry-template");

// Show/hide the household members section based on the has_dependants answer.
hasDependantsSelect.addEventListener("change", () => {
  if (hasDependantsSelect.value === "yes") {
    dependantsSection.classList.remove("hidden");
    // Add one entry by default so the user isn't staring at an empty section.
    if (dependantsContainer.children.length === 0) {
      addDependantEntry();
    }
  } else {
    dependantsSection.classList.add("hidden");
  }
});

function addDependantEntry() {
  const clone = dependantTemplate.content.cloneNode(true);
  dependantsContainer.appendChild(clone);
}

addDependantBtn.addEventListener("click", addDependantEntry);

// Event delegation: toggle the email field per-row based on that row's relationship type,
// and handle the remove button, since rows are added/removed dynamically.
dependantsContainer.addEventListener("change", (e) => {
  if (e.target.classList.contains("dependant-type")) {
    const entry = e.target.closest(".dependant-entry");
    const emailWrapper = entry.querySelector(".dependant-email-wrapper");
    if (e.target.value === "adult") {
      emailWrapper.classList.remove("hidden");
    } else {
      emailWrapper.classList.add("hidden");
      entry.querySelector(".dependant-email").value = "";
    }
  }
});

dependantsContainer.addEventListener("click", (e) => {
  if (e.target.classList.contains("remove-dependant-btn")) {
    e.target.closest(".dependant-entry").remove();
  }
});

function collectDependants() {
  const entries = dependantsContainer.querySelectorAll(".dependant-entry");
  const dependants = [];

  for (const entry of entries) {
    const name = entry.querySelector(".dependant-name").value.trim();
    const dob = entry.querySelector(".dependant-dob").value;
    const type = entry.querySelector(".dependant-type").value;
    const relationship = entry.querySelector(".dependant-relationship").value.trim();
    const email = entry.querySelector(".dependant-email").value.trim();

    if (!name) continue; // skip empty rows rather than blocking submission

    dependants.push({
      name,
      date_of_birth: dob || null,
      type,
      relationship: relationship || null,
      // Only adults carry an email/invite — children don't get their own account.
      email: type === "adult" && email ? email : null
    });
  }

  return dependants;
}

// --- main submit handler ---
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

  // --- SE2L-23: insert household members now that primary_user_id exists ---
  if (hasDependantsSelect.value === "yes") {
    const dependants = collectDependants();

    if (dependants.length > 0) {
      const rows = dependants.map((d) => ({
        id: crypto.randomUUID(),
        primary_user_id: userId,
        type: d.type,
        name: d.name,
        date_of_birth: d.date_of_birth,
        relationship: d.relationship,
        email: d.email,
        // Adults with an email get an invite token now; SE2L-25 sends the actual
        // invite email using this token. Children have no invite flow.
        invite_status: d.email ? "pending" : null,
        invite_token: d.email ? crypto.randomUUID() : null
      }));

      const { error: dependantsError } = await supabaseClient
        .from("dependants")
        .insert(rows);

      if (dependantsError) {
        // Don't block the whole signup over this — the account and journey are
        // already created successfully at this point. Surface it and move on.
        console.error("Failed to save household members:", dependantsError.message);
        alert("Your journey was created, but we couldn't save your household members. You can add them later from your dashboard.");
        window.location.href = "dashboard.html";
        return;
      }

      // --- SE2L-25: send invite emails to adult dependants ---
      // Fires immediately rather than through notifications_queue, since an
      // invite should go out the moment someone's added, not on a schedule.
      const adultInvites = rows.filter((r) => r.type === "adult" && r.email);

      for (const invite of adultInvites) {
        const { error: inviteError } = await supabaseClient.functions.invoke(
          "send-dependant-invite",
          {
            body: {
              email: invite.email,
              inviteToken: invite.invite_token,
              dependantName: invite.name,
              appOrigin: window.location.origin + window.location.pathname.replace(/\/[^/]*$/, "")
            }
          }
        );

        if (inviteError) {
          // Same principle as above: the dependant row already exists, so this
          // isn't fatal — just log it so it's visible for troubleshooting.
          console.error(`Failed to send invite to ${invite.email}:`, inviteError.message);
        }
      }

      // --- SE2L-29: assign checklist items to minor dependants ---
      // Single source of truth for the age-matching logic lives in the
      // assign-child-checklist function, so this stays a thin call rather
      // than duplicating age-matching logic here.
      const minors = rows.filter((r) => r.type === "minor");

      for (const minor of minors) {
        const { error: checklistError } = await supabaseClient.functions.invoke(
          "assign-child-checklist",
          { body: { dependantId: minor.id } }
        );

        if (checklistError) {
          // Not fatal — the dependant record itself is already saved.
          console.error(`Failed to assign checklist for ${minor.name}:`, checklistError.message);
        }
      }
    }
  }

  alert("Journey created! Redirecting to your dashboard...");
  window.location.href = "dashboard.html";
});