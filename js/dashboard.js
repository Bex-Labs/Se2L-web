async function loadDashboard() {
  const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

  if (authError || !user) {
    window.location.href = "login.html";
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
    app_manager: t("roles.app_manager"),
    super_admin: t("roles.super_admin")
  };
  const emailEl = document.getElementById("sidebar-user-email");
  const rolePillEl = document.getElementById("sidebar-role-pill");
  const avatarEl = document.getElementById("sidebar-identity-avatar");
  if (emailEl) emailEl.textContent = user.email || t("common.unknown_user");
  if (rolePillEl) rolePillEl.textContent = roleLabels[profile.role] || t("roles.newcomer");
  if (avatarEl && user.email) {
    const namePart = user.email.split("@")[0];
    const initials = namePart.replace(/[^a-zA-Z]/g, " ").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
    avatarEl.textContent = initials || namePart.slice(0, 2).toUpperCase();
  }

  // --- SE2L-39: For Your Family section ---
  // Called early and independently of the task-list logic below, since that
  // logic has early returns (no tasks for current phase) that would skip
  // anything placed after it in this function.
  loadFamilySection(user.id);

  const welcomeDiv = document.getElementById("welcome-message");
  welcomeDiv.innerHTML = `
    <h2 class="dashboard-hero-heading">${t("dashboard.welcome_heading")}</h2>
    <p class="dashboard-hero-meta">
      ${profile.visa_type.replace("_", " ")} · ${profile.uk_region} · ${t("dashboard.arrived_prefix")} <span class="dashboard-hero-meta-mono">${profile.arrival_date}</span>
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

  timelineDiv.classList.add("phase-stepper");
  timelineDiv.innerHTML = phases.map(p => {
    const isPast = p.sort_order < currentSortOrder;
    const isCurrent = currentPhase && p.id === currentPhase.id;
    if (isPast) {
      return `<div class="phase-step is-done bg-green-50" data-review-phase-id="${p.id}" data-review-phase-name="${p.name}" tabindex="0">
                <span class="phase-step-dot text-green-600">✓</span>
                <span class="phase-step-label text-xs">${p.name}</span>
              </div>`;
    } else if (isCurrent) {
      return `<div class="phase-step is-current bg-indigo-50 border-indigo-600">
                <span class="phase-step-dot"></span>
                <span class="phase-step-label text-xs font-medium text-indigo-700">${p.name}</span>
              </div>`;
    } else {
      return `<div class="phase-step is-locked bg-slate-100 text-slate-400">
                <span class="phase-step-dot"></span>
                <span class="phase-step-label text-xs">${p.name}</span>
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
    taskListDiv.innerHTML = `<p class="text-sm text-slate-500">${t("dashboard.no_active_phase")}</p>`;
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
    taskListDiv.innerHTML = `<p class="text-sm text-red-600">${t("dashboard.tasks_load_error")}</p>`;
    return;
  }

  if (!tasks || tasks.length === 0) {
    taskListDiv.innerHTML = `<p class="text-sm text-slate-500">${t("dashboard.no_tasks_phase")}</p>`;
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
  taskCountSpan.textContent = t("dashboard.task_count", { completed: completedCount, total: tasks.length });

  const categoryIcons = {
    healthcare: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21C12 21 4 15.5 4 9.5a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9.5C20 15.5 12 21 12 21z"/></svg>`,
    banking: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="10" width="18" height="9" rx="1"/><path d="M3 10L12 4l9 6"/><line x1="7" y1="13" x2="7" y2="16"/><line x1="12" y1="13" x2="12" y2="16"/><line x1="17" y1="13" x2="17" y2="16"/></svg>`,
    housing: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>`,
    default: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`
  };
  const iconTileVariant = { Critical: "", Important: "icon-tile-mint", Optional: "" };
  let firstIncompleteAssigned = false;

  taskListDiv.classList.remove("flex", "flex-col", "gap-3");
  taskListDiv.classList.add("task-grid");
  taskListDiv.innerHTML = tasks.map(task => {
    const isDone = completedIds.has(task.id);
    const isFirstIncomplete = !isDone && !firstIncompleteAssigned;
    if (!isDone) firstIncompleteAssigned = true;

    const categoryKey = (task.category || "").toLowerCase();
    const icon = categoryIcons[categoryKey] || categoryIcons.default;
    const statusBadge = isDone
      ? `<span class="badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> ${t("common.done")}</span>`
      : isFirstIncomplete
        ? `<span class="badge">${t("dashboard.status_in_progress")}</span>`
        : `<span class="badge badge-pending">${t("dashboard.status_pending")}</span>`;
    const cardStatusClass = isDone ? "" : isFirstIncomplete ? "card-status-progress" : "card-status-pending";
    const ctaClass = isFirstIncomplete ? "btn-primary" : "btn-secondary";
    const ctaLabel = isDone ? t("common.review") : isFirstIncomplete ? t("dashboard.cta_continue") : t("dashboard.cta_view");

    return `
    <div class="card ${cardStatusClass} task-grid-card">
      <div class="flex justify-between items-start">
        <div class="icon-tile ${iconTileVariant[task.urgency] || ""}">${icon}</div>
        ${statusBadge}
      </div>
      <p class="task-grid-title ${isDone ? "line-through" : ""}">${task.title}</p>
      <p class="task-grid-desc">${task.category || t("common.general")} · ${task.urgency}</p>
      <a href="task-detail.html?id=${task.id}" class="btn ${ctaClass} btn-sm">
        ${ctaLabel}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </a>
    </div>
  `;
  }).join("");

  // Progress strip — quick day-count + completion summary using data
  // already computed above, no extra queries needed.
  const progressStrip = document.getElementById("progress-strip");
  if (progressStrip) {
    progressStrip.classList.remove("hidden");
    const pct = tasks.length ? Math.round((completedCount / tasks.length) * 100) : 0;
    progressStrip.innerHTML = `
      <div class="progress-strip-card">
        <div class="flex items-center justify-between">
          <span class="text-slate-600">${t("dashboard.progress_day", { day: daysSinceArrival + 1, phase: currentPhase.name })}</span>
          <span class="progress-strip-pct">${pct}% <span class="progress-strip-pct-label">${t("dashboard.progress_complete_label")}</span></span>
        </div>
        <div class="progress-bar-track">
          <div class="progress-bar-fill" style="width: ${pct}%;"></div>
        </div>
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
        <p class="text-xs text-slate-500 mb-1">${t("dashboard.coming_up_next")}</p>
        <p class="text-sm font-medium">${nextPhase.name} · ${count || 0} ${count === 1 ? t("common.task_singular") : t("common.task_plural")}</p>
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
    const relationshipLabel = m.relationship ? m.relationship : t("dashboard.relationship_child");
    return `
      <div class="family-member-card">
        <div class="family-member-avatar">${initialsFor(m.name)}</div>
        <div>
          <p class="family-member-name">${m.name} <span class="family-member-relationship">· ${relationshipLabel}</span></p>
          <p class="family-member-status">${t("dashboard.tasks_pending", { count, taskword: count === 1 ? t("common.task_singular") : t("common.task_plural") })}</p>
        </div>
      </div>
    `;
  }).join("");

  const adultStatusLabel = {
    pending: t("dashboard.invite_sent"),
    accepted: t("dashboard.account_set_up")
  };

  const adultRows = adults.map(a => {
    const relationshipLabel = a.relationship ? a.relationship : t("dashboard.relationship_adult");
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
      <p class="text-sm font-medium text-indigo-700 mb-3">${t("dashboard.family_heading")}</p>
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
  heading.textContent = `${t("dashboard.reviewing_prefix")} ${phaseName}`;
  listDiv.innerHTML = `<p class="text-sm text-slate-400">${t("common.loading")}</p>`;
  section.scrollIntoView({ behavior: "smooth", block: "nearest" });

  const { data: tasks, error } = await supabaseClient
    .from("tasks")
    .select("*, task_phases!inner(phase_id), task_visa_types!inner(visa_type), task_uk_regions!inner(uk_region), task_links(url)")
    .eq("task_phases.phase_id", phaseId)
    .eq("task_visa_types.visa_type", visaType)
    .eq("task_uk_regions.uk_region", ukRegion)
    .eq("status", "published");

  if (error) {
    listDiv.innerHTML = `<p class="text-sm text-red-600">${t("dashboard.phase_tasks_load_error")}</p>`;
    return;
  }

  if (!tasks || tasks.length === 0) {
    listDiv.innerHTML = `<p class="text-sm text-slate-400">${t("dashboard.phase_no_tasks")}</p>`;
    return;
  }

  const shareBase = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, "");

  listDiv.innerHTML = tasks.map(task => {
    const shareUrl = `${shareBase}/task-detail.html?id=${task.id}`;
    const linkRow = task.task_links?.[0]?.url
      ? `<a href="${task.task_links[0].url}" target="_blank" rel="noopener" class="text-xs text-indigo-600 font-medium">${t("dashboard.guidance_link")}</a>`
      : "";
    return `
      <div class="bg-slate-50 border border-slate-200 rounded-lg p-3 flex justify-between items-center">
        <div>
          <p class="text-sm font-medium">${task.title}</p>
          <div class="flex gap-2 items-center mt-1">
            ${linkRow}
          </div>
        </div>
        <button type="button" data-share-url="${shareUrl}" data-share-title="${task.title}" class="share-task-btn btn btn-ghost btn-sm">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.5" x2="15.4" y2="6.5"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/></svg>
          ${t("common.share")}
        </button>
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
    btn.textContent = t("common.copied");
    setTimeout(() => { btn.textContent = original; }, 1500);
  } catch (err) {
    alert(t("dashboard.copy_link_failed_prefix") + url);
  }
}

document.getElementById("phase-review-close-btn").addEventListener("click", () => {
  document.getElementById("phase-review-section").classList.add("hidden");
});