const form = document.getElementById("dependants-form");
const dependantsContainer = document.getElementById("dependants-container");
const addDependantBtn = document.getElementById("add-dependant-btn");
const dependantTemplate = document.getElementById("dependant-entry-template");
const skipLink = document.getElementById("dependants-skip-link");

// Where to go after saving (or skipping) — Settings if reached from there
// to add household members later, dashboard by default (e.g. during
// initial onboarding).
const returnTo = new URLSearchParams(window.location.search).get("return") || "dashboard.html";
if (skipLink) skipLink.href = returnTo;

let currentUserId = null;

// By the time someone reaches this page, they've already completed
// onboarding.html (profile row exists) and chose "yes" to dependants —
// or navigated here directly, which we treat the same way as long as
// they're authenticated.
(async function initSession() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session?.user) {
    window.location.href = "login.html";
    return;
  }
  currentUserId = session.user.id;

  // Start with one entry so the person isn't staring at an empty form.
  if (dependantsContainer.children.length === 0) {
    addDependantEntry();
  }
})();

function addDependantEntry() {
  const clone = dependantTemplate.content.cloneNode(true);
  dependantsContainer.appendChild(clone);
  if (window.se2lTranslateElement) {
    window.se2lTranslateElement(dependantsContainer);
  }
}

addDependantBtn.addEventListener("click", addDependantEntry);

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
      email: type === "adult" && email ? email : null
    });
  }

  return dependants;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const dependants = collectDependants();

  if (dependants.length === 0) {
    // Nothing filled in — treat the same as "skip for now".
    window.location.href = "dashboard.html";
    return;
  }

  const rows = dependants.map((d) => ({
    id: crypto.randomUUID(),
    primary_user_id: currentUserId,
    type: d.type,
    name: d.name,
    date_of_birth: d.date_of_birth,
    relationship: d.relationship,
    email: d.email,
    invite_status: d.email ? "pending" : null,
    invite_token: d.email ? crypto.randomUUID() : null
  }));

  const { error: dependantsError } = await supabaseClient
    .from("dependants")
    .insert(rows);

  if (dependantsError) {
    console.error("Failed to save household members:", dependantsError.message);
    se2lToast(window.t("onboarding.dependants_save_failed"), "error");
    window.location.href = "dashboard.html";
    return;
  }

  // --- SE2L-25: send invite emails to adult dependants ---
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
      console.error(`Failed to send invite to ${invite.email}:`, inviteError.message);
    }
  }

  // --- SE2L-29: assign checklist items to minor dependants ---
  const minors = rows.filter((r) => r.type === "minor");

  for (const minor of minors) {
    const { error: checklistError } = await supabaseClient.functions.invoke(
      "assign-child-checklist",
      { body: { dependantId: minor.id } }
    );

    if (checklistError) {
      console.error(`Failed to assign checklist for ${minor.name}:`, checklistError.message);
    }
  }

  // Returns to Settings if reached from there to add household members
  // later, or the dashboard by default (e.g. during initial onboarding).
  se2lToast(window.t("onboarding.success_message"), "success");
  window.location.href = returnTo;
});