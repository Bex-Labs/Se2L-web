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

  if (profile.role === "super_admin") {
    document.getElementById("super-admin-link")?.classList.remove("hidden");
  }

  // Populates the sidebar identity strip. Reuses the profile already
  // fetched above rather than a separate query — purely presentational.
  const roleLabels = {
    app_manager: "App Manager",
    super_admin: "Super Admin"
  };
  const emailEl = document.getElementById("sidebar-user-email");
  const rolePillEl = document.getElementById("sidebar-role-pill");
  if (emailEl) emailEl.textContent = user.email || "Unknown user";
  if (rolePillEl) rolePillEl.textContent = roleLabels[profile.role] || "Newcomer";

  // --- SE2L-39: For Your Family section ---
  // Called early and independently of the task-list logic below, since that
  // logic has early returns (no tasks for current phase) that would skip
  // anything placed after it in this function.
  loadFamilySection(user.id);

  const welcomeDiv = document.getElementById("welcome-message");
  welcomeDiv.innerHTML = `
    <h2 class="text-lg font-semibold">Welcome back!</h2>
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
      return `<div class="flex-1 text-center py-2 px-1 rounded-lg bg-green-50 cursor-pointer hover:bg-green-100" data-review-phase-id="${p.id}" data-review-phase-name="${p.name}" tabindex="0">
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

  timelineDiv.querySelectorAll("[data-review-phase-id]").forEach(el => {
    el.addEventListener("click", () => {
      loadPhaseReview(el.dataset.reviewPhaseId, el.dataset.reviewPhaseName, user.id, profile.visa_type, profile.uk_region);
    });
    el.addEventListener("keyup", (e) => {
      if (e.key === "Enter") {
        loadPhaseReview(el.dataset.reviewPhaseId, el.dataset.reviewPhaseName, user.id, profile.visa_type, profile.uk_region);
      }
    });
  });

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
        <span class="text-xs text-slate-400">· ${t.category || "General"}</span>
        <p class="text-sm font-medium mt-0.5 ${isDone ? "line-through" : ""}">${t.title}</p>
      </div>
      <span>${isDone ? "✓" : "›"}</span>
    </a>
  `;
  }).join("");

  // Progress strip — quick day-count + completion summary using data
  // already computed above, no extra queries needed.
  const progressStrip = document.getElementById("progress-strip");
  if (progressStrip) {
    progressStrip.classList.remove("hidden");
    progressStrip.innerHTML = `
      <div class="bg-white border border-slate-200 rounded-xl p-3 flex items-center justify-between text-sm">
        <span class="text-slate-600">Day ${daysSinceArrival + 1} of your journey · ${currentPhase.name}</span>
        <span class="font-medium">${completedCount} of ${tasks.length} tasks complete</span>
      </div>
    `;
  }

  // Sidebar quick-jump list — mirrors today's tasks so they're reachable
  // without scrolling the main content, same urgency colors as the cards.
  const sidebarJumpList = document.getElementById("sidebar-task-jump-list");
  if (sidebarJumpList) {
    const sidebarDotColor = {
      Critical: "background: var(--color-critical);",
      Important: "background: var(--color-warning);",
      Optional: "background: var(--color-text-muted);"
    };
    sidebarJumpList.innerHTML = tasks.map(t => {
      const isDone = completedIds.has(t.id);
      return `
        <a href="task-detail.html?id=${t.id}" class="sidebar-task-jump-item ${isDone ? "is-done" : ""}">
          <span class="sidebar-task-jump-dot" style="${sidebarDotColor[t.urgency] || sidebarDotColor.Optional}"></span>
          <span>${t.title}</span>
        </a>
      `;
    }).join("");
  }

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

  function initialsFor(name) {
    return (name || "?").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
  }

  const minorRows = minors.map(m => {
    const count = pendingCounts[m.id] || 0;
    const relationshipLabel = m.relationship ? m.relationship : "Child";
    return `
      <div class="family-member-card">
        <div class="family-member-avatar">${initialsFor(m.name)}</div>
        <div>
          <p class="family-member-name">${m.name} <span class="family-member-relationship">· ${relationshipLabel}</span></p>
          <p class="family-member-status">${count} task${count === 1 ? "" : "s"} pending</p>
        </div>
      </div>
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
      <div class="family-member-card">
        <div class="family-member-avatar">${initialsFor(a.name)}</div>
        <div>
          <p class="family-member-name">${a.name} <span class="family-member-relationship">· ${relationshipLabel}</span></p>
          <p class="family-member-status">${statusLabel}</p>
        </div>
      </div>
    `;
  }).join("");

  familyDiv.innerHTML = `
    <div class="mt-6 bg-indigo-50 rounded-xl p-4">
      <p class="text-sm font-medium text-indigo-700 mb-3">For your family</p>
      <div class="flex flex-col gap-2">
        ${minorRows}
        ${adultRows}
      </div>
    </div>
  `;
}

// Sign out handled by shell.js, shared across every shelled page.

// --- Review a completed phase's tasks ---
// Triggered by clicking a past (checkmarked) phase tile in the timeline.
// Read-only: these tasks are already done, so this is purely for looking
// back at guidance/links, not for re-marking completion.
async function loadPhaseReview(phaseId, phaseName, userId, visaType, ukRegion) {
  const section = document.getElementById("phase-review-section");
  const heading = document.getElementById("phase-review-heading");
  const listDiv = document.getElementById("phase-review-tasks");

  section.classList.remove("hidden");
  heading.textContent = `Reviewing: ${phaseName}`;
  listDiv.innerHTML = `<p class="text-sm text-slate-400">Loading...</p>`;
  section.scrollIntoView({ behavior: "smooth", block: "nearest" });

  const { data: tasks, error } = await supabaseClient
    .from("tasks")
    .select("*, task_phases!inner(phase_id), task_visa_types!inner(visa_type), task_uk_regions!inner(uk_region), task_links(url)")
    .eq("task_phases.phase_id", phaseId)
    .eq("task_visa_types.visa_type", visaType)
    .eq("task_uk_regions.uk_region", ukRegion)
    .eq("status", "published");

  if (error) {
    listDiv.innerHTML = `<p class="text-sm text-red-600">Could not load this phase's tasks.</p>`;
    return;
  }

  if (!tasks || tasks.length === 0) {
    listDiv.innerHTML = `<p class="text-sm text-slate-400">No tasks were assigned to this phase.</p>`;
    return;
  }

  const shareBase = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, "");

  listDiv.innerHTML = tasks.map(t => {
    const shareUrl = `${shareBase}/task-detail.html?id=${t.id}`;
    const linkRow = t.task_links?.[0]?.url
      ? `<a href="${t.task_links[0].url}" target="_blank" rel="noopener" class="text-xs text-indigo-600 font-medium">Guidance link ↗</a>`
      : "";
    return `
      <div class="bg-slate-50 border border-slate-200 rounded-lg p-3 flex justify-between items-center">
        <div>
          <p class="text-sm font-medium">${t.title}</p>
          <div class="flex gap-2 items-center mt-1">
            ${linkRow}
          </div>
        </div>
        <button type="button" data-share-url="${shareUrl}" data-share-title="${t.title}" class="share-task-btn text-xs text-slate-500 font-medium border border-slate-300 rounded-lg px-2 py-1">Share</button>
      </div>
    `;
  }).join("");

  listDiv.querySelectorAll(".share-task-btn").forEach(btn => {
    btn.addEventListener("click", () => shareLink(btn.dataset.shareUrl, btn.dataset.shareTitle, btn));
  });
}

// Prefers the device's native share sheet (great on mobile — direct to
// WhatsApp, Messages, email, etc.); falls back to copying the link with
// a brief on-button confirmation where the Web Share API isn't available.
async function shareLink(url, title, btn) {
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
    } catch (err) {
      // User cancelled the share sheet — not an error worth surfacing.
    }
    return;
  }

  try {
    await navigator.clipboard.writeText(url);
    const original = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = original; }, 1500);
  } catch (err) {
    alert("Could not copy link. You can copy it manually: " + url);
  }
}

document.getElementById("phase-review-close-btn").addEventListener("click", () => {
  document.getElementById("phase-review-section").classList.add("hidden");
});