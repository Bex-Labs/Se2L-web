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

  const timelineDiv = document.querySelector(".flex.gap-2.mb-8");
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

  const taskListDiv = document.querySelector(".flex.flex-col.gap-3");
  const taskCountSpan = document.querySelector(".flex.justify-between.items-center.mb-4 span");

  if (!currentPhase) {
    taskListDiv.innerHTML = `<p class="text-sm text-slate-500">No active phase yet.</p>`;
    taskCountSpan.textContent = "";
    return;
  }

  const { data: tasks, error: tasksError } = await supabaseClient
    .from("tasks")
    .select("*, task_phases!inner(phase_id), task_visa_types!inner(visa_type), task_uk_regions!inner(uk_region)")
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

document.getElementById("signout-btn").addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  window.location.href = "login.html";
});