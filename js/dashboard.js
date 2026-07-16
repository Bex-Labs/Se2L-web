async function loadDashboard() {
  const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

  if (authError || !user) {
    window.location.href = "onboarding.html";
    return;
  }

  const { data: profile, error: profileError } = await supabaseClient
    .from("users")
    .select("*")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    console.error(profileError);
    return;
  }

  if (profile.role === "app_manager") {
    document.getElementById("app-manager-link").classList.remove("hidden");
  }

  // --- SE2L-39: For Your Family section ---
  // Called early and independently of the task-list logic below, since that
  // logic has early returns (no tasks for current phase) that would skip
  // anything placed after it in this function.
  loadFamilySection(user.id);

  const welcomeDiv = document.getElementById("welcome-message");
  welcomeDiv.innerHTML = `
    <p class="text-lg font-semibold">Welcome back!</p>
    <p class="text-sm text-slate-500">
      ${profile.visa_type.replace("_", " ")} · ${profile.uk_region} · Arrived ${profile.arrival_date}
    </p>
  `;

  const { data: journey, error: journeyError } = await supabaseClient
    .from("journeys")
    .select("id")
    .eq("visa_type", profile.visa_type)
    .eq("uk_region", profile.uk_region)
    .single();

  if (journeyError || !journey) {
    console.error("No journey found for this visa type/region yet.", journeyError);
    return;
  }

  const { data: phases, error: phasesError } = await supabaseClient
    .from("phases")
    .select("*")
    .eq("journey_id", journey.id)
    .order("sort_order", { ascending: true });

  if (phasesError || !phases) {
    console.error(phasesError);
    return;
  }

  const arrival = new Date(profile.arrival_date);
  const today = new Date();
  const daysSinceArrival = Math.floor((today - arrival) / (1000 * 60 * 60 * 24));

  const currentPhase = phases.find(p =>
    daysSinceArrival >= p.days_after_arrival_start &&
    daysSinceArrival < p.days_after_arrival_end
  );

  const timelineDiv = document.getElementById("phase-timeline");
  const currentSortOrder = currentPhase ? currentPhase.sort_order : phases[phases.length - 1].sort_order + 1;

  timelineDiv.innerHTML = phases.map(p => {
    const isPast = p.sort_order < currentSortOrder;
    const isCurrent = currentPhase && p.id === currentPhase.id;
    if (isPast) {
      return `<div class="flex-1 text-center py-2 px-1 rounded-lg bg-green-50">
                <div class="text-green-600 text-sm">✓</div>
                <div class="text-xs mt-1">${p.name}</div>
              </div>`;
    } else if (isCurrent) {
      return `<div class="flex-1 text-center py-2 px-1 rounded-lg bg-indigo-50 border-2 border-indigo-600">
                <div class="text-xs font-medium mt-1 text-indigo-700">${p.name}</div>
              </div>`;
    } else {
      return `<div class="flex-1 text-center py-2 px-1 rounded-lg bg-slate-100 text-slate-400">
                <div class="text-xs mt-1">${p.name}</div>
              </div>`;
    }
  }).join("");

  const taskListDiv = document.getElementById("task-list");
  const taskCountSpan = document.getElementById("task-count");

  if (!currentPhase) {
    taskListDiv.innerHTML = `<p class="text-sm text-slate-500">No active phase yet.</p>`;
    taskCountSpan.textContent = "";
    return;
  }

  const { data: tasks, error: tasksError } = await supabaseClient
    .from("tasks")
    .select("*, task_phases!inner(phase_id, sort_order), task_visa_types!inner(visa_type), task_uk_regions!inner(uk_region)")
    .eq("task_phases.phase_id", currentPhase.id)
    .eq("task_visa_types.visa_type", profile.visa_type)
    .eq("task_uk_regions.uk_region", profile.uk_region)
    .eq("status", "published");

  if (tasksError) {
    console.error(tasksError);
    taskListDiv.innerHTML = `<p class="text-sm text-red-600">Could not load tasks.</p>`;
    return;
  }

  if (!tasks || tasks.length === 0) {
    taskListDiv.innerHTML = `<p class="text-sm text-slate-500">No tasks for this phase yet.</p>`;
    taskCountSpan.textContent = "";
    return;
  }

  const { data: completedStates } = await supabaseClient
    .from("user_task_state")
    .select("task_id")
    .eq("user_id", user.id)
    .eq("status", "complete");

  const completedIds = new Set((completedStates || []).map(s => s.task_id));

  const urgencyColor = {
    Critical: "text-red-600",
    Important: "text-amber-600",
    Optional: "text-slate-500"
  };

  // SE2L-66: urgency tier first (Critical > Important > Optional) — this
  // stays fixed because urgency reflects real consequences (visa deadlines,
  // healthcare windows). The App Manager's manual sort_order only breaks
  // ties *within* the same tier, so it can't bury a Critical task under
  // Optional ones by accident.
  const urgencyRank = { Critical: 0, Important: 1, Optional: 2 };
  tasks.sort((a, b) => {
    const rankA = urgencyRank[a.urgency] ?? 3;
    const rankB = urgencyRank[b.urgency] ?? 3;
    if (rankA !== rankB) return rankA - rankB;
    const sortA = a.task_phases?.[0]?.sort_order ?? 0;
    const sortB = b.task_phases?.[0]?.sort_order ?? 0;
    return sortA - sortB;
  });

  const completedCount = tasks.filter(t => completedIds.has(t.id)).length;
  taskCountSpan.textContent = `${completedCount} of ${tasks.length} complete`;

  taskListDiv.innerHTML = tasks.map(t => {
    const isDone = completedIds.has(t.id);
    return `
    <a href="task-detail.html?id=${t.id}" class="bg-white border border-slate-200 rounded-xl p-4 flex justify-between items-center ${isDone ? "opacity-60" : ""}">
      <div>
        <span class="text-xs ${urgencyColor[t.urgency] || "text-slate-500"} font-medium">${t.urgency}</span>
        <p class="text-sm font-medium mt-0.5 ${isDone ? "line-through" : ""}">${t.title}</p>
      </div>
      <span>${isDone ? "✓" : "›"}</span>
    </a>
  `;
  }).join("");

  const nextPhase = phases.find(p => p.sort_order === currentSortOrder + 1);
  const teaserDiv = document.getElementById("upcoming-phase-teaser");

  if (nextPhase) {
    const { count } = await supabaseClient
      .from("tasks")
      .select("*, task_phases!inner(phase_id), task_visa_types!inner(visa_type), task_uk_regions!inner(uk_region)", { count: "exact", head: true })
      .eq("task_phases.phase_id", nextPhase.id)
      .eq("task_visa_types.visa_type", profile.visa_type)
      .eq("task_uk_regions.uk_region", profile.uk_region)
      .eq("status", "published");

    teaserDiv.innerHTML = `
      <div class="bg-slate-100 rounded-xl p-4">
        <p class="text-xs text-slate-500 mb-1">Coming up next</p>
        <p class="text-sm font-medium">${nextPhase.name} · ${count || 0} task${count === 1 ? "" : "s"}</p>
      </div>
    `;
  } else {
    teaserDiv.innerHTML = "";
  }
}

loadDashboard();

// --- SE2L-39: For Your Family dashboard section ---
//
// Queries ONLY through family_dependants_view (built in SE2L-27), never the
// raw `dependants` table with a custom join — that view deliberately excludes
// email/invite_token and has no path to an adult dependant's own users/
// user_task_state rows, which is what keeps an accepted adult's account
// private from the primary user, per the SE2L-27 boundary.
async function loadFamilySection(userId) {
  const familyDiv = document.getElementById("family-section");

  const { data: dependants, error: dependantsError } = await supabaseClient
    .from("family_dependants_view")
    .select("*")
    .eq("primary_user_id", userId);

  if (dependantsError || !dependants || dependants.length === 0) {
    familyDiv.innerHTML = ""; // no family members — section simply doesn't show
    return;
  }

  const minors = dependants.filter(d => d.type === "minor");
  const adults = dependants.filter(d => d.type === "adult");

  // Bulk-fetch pending checklist counts for all minors in one query, rather
  // than one query per dependant.
  let pendingCounts = {};
  if (minors.length > 0) {
    const minorIds = minors.map(m => m.id);
    const { data: states } = await supabaseClient
      .from("dependant_checklist_state")
      .select("dependant_id, status")
      .in("dependant_id", minorIds)
      .eq("status", "pending");

    for (const s of states || []) {
      pendingCounts[s.dependant_id] = (pendingCounts[s.dependant_id] || 0) + 1;
    }
  }

  const minorRows = minors.map(m => {
    const count = pendingCounts[m.id] || 0;
    const relationshipLabel = m.relationship ? m.relationship : "Child";
    return `
      <p class="text-sm text-indigo-700">
        ${relationshipLabel} · ${m.name} — ${count} task${count === 1 ? "" : "s"} pending
      </p>
    `;
  }).join("");

  const adultStatusLabel = {
    pending: "Invite sent",
    accepted: "Account set up"
  };

  const adultRows = adults.map(a => {
    const relationshipLabel = a.relationship ? a.relationship : "Adult";
    const statusLabel = adultStatusLabel[a.invite_status] || a.invite_status || "—";
    return `
      <p class="text-sm text-indigo-700">
        ${relationshipLabel} · ${a.name} — ${statusLabel}
      </p>
    `;
  }).join("");

  familyDiv.innerHTML = `
    <div class="mt-6 bg-indigo-50 rounded-xl p-4">
      <p class="text-sm font-medium text-indigo-700 mb-2">For your family</p>
      <div class="flex flex-col gap-1">
        ${minorRows}
        ${adultRows}
      </div>
    </div>
  `;
}

document.getElementById("signout-btn").addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  window.location.href = "login.html";
});