let currentUser = null;
let currentUserRole = null;

async function checkAppManagerAccess() {
  const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

  if (authError || !user) {
    window.location.href = "login.html";
    return null;
  }

  const { data: profile } = await supabaseClient
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  // Super Admin needs access to this same page to review and publish
  // what App Managers submit — see SE2L-95 follow-up: publishing is
  // gated to Super Admin only, so they must be able to reach this screen.
  if (!profile || (profile.role !== "app_manager" && profile.role !== "super_admin")) {
    document.querySelector(".max-w-2xl").innerHTML = `
      <p class="text-sm text-red-600 mt-10">${t("common.access_denied")}</p>
    `;
    return null;
  }

  currentUserRole = profile.role;
  return user;
}

// --- SE2L-64: create new Journey for a visa category ---

let phaseRowCounter = 0;

function addPhaseRow(prefill) {
  const rowId = `phase-row-${phaseRowCounter++}`;
  const row = document.createElement("div");
  row.id = rowId;
  row.className = "flex gap-2 items-start";
  row.innerHTML = `
    <input type="text" class="phase-name flex-1 form-input" placeholder="${t("appmgr.phase_name_placeholder")}" value="${prefill?.name || ""}" />
    <input type="number" class="phase-start form-input" style="width:5rem;" placeholder="${t("appmgr.phase_from_placeholder")}" value="${prefill?.start ?? ""}" />
    <input type="number" class="phase-end form-input" style="width:5rem;" placeholder="${t("appmgr.phase_to_placeholder")}" value="${prefill?.end ?? ""}" />
    <button type="button" class="remove-phase-row-btn text-xs text-red-600 font-medium px-2 py-2" data-row-id="${rowId}">${t("common.remove")}</button>
  `;
  document.getElementById("phase-rows").appendChild(row);

  row.querySelector(".remove-phase-row-btn").addEventListener("click", () => {
    document.getElementById(rowId)?.remove();
  });
}

function resetJourneyForm() {
  document.getElementById("journey-form").reset();
  document.getElementById("journey_visa_type_other").classList.add("hidden");
  document.getElementById("phase-rows").innerHTML = "";
  addPhaseRow();
  addPhaseRow();
}

function collectPhaseRows() {
  const rows = Array.from(document.querySelectorAll("#phase-rows > div"));
  return rows.map((row, index) => ({
    name: row.querySelector(".phase-name").value.trim(),
    days_after_arrival_start: row.querySelector(".phase-start").value,
    days_after_arrival_end: row.querySelector(".phase-end").value,
    sort_order: index
  }));
}

async function loadExistingJourneys() {
  const { data: journeys, error } = await supabaseClient
    .from("journeys")
    .select("id, name, visa_type, uk_region, phases(id)")
    .order("visa_type", { ascending: true });

  const listDiv = document.getElementById("journey-list");

  if (error || !journeys || journeys.length === 0) {
    listDiv.innerHTML = `<p class="text-sm text-slate-400">${t("appmgr.no_journeys")}</p>`;
    return;
  }

  listDiv.innerHTML = journeys.map(j => `
    <div class="card" id="journey-card-${j.id}">
      <div class="flex justify-between items-center">
        <div>
          <p class="text-sm font-medium">${j.name}</p>
          <p class="text-xs text-slate-500 mt-0.5">
            ${j.visa_type.replace("_", " ")} · ${j.uk_region.replace("_", " ")} · ${j.phases?.length || 0} ${j.phases?.length === 1 ? t("common.phase_singular") : t("common.phase_plural")}
          </p>
        </div>
        <div class="flex gap-3 items-center">
          <button data-clone-journey-id="${j.id}" class="text-xs text-slate-500 font-medium">${t("common.clone")}</button>
          <button data-edit-journey-id="${j.id}" class="text-xs text-indigo-600 font-medium">${t("appmgr.edit_phases")}</button>
        </div>
      </div>
      <div id="phase-editor-${j.id}" class="hidden mt-3 pt-3 border-t border-slate-200"></div>
    </div>
  `).join("");

  listDiv.querySelectorAll("[data-edit-journey-id]").forEach(btn => {
    btn.addEventListener("click", () => toggleJourneyPhaseEditor(btn.dataset.editJourneyId));
  });

  listDiv.querySelectorAll("[data-clone-journey-id]").forEach(btn => {
    btn.addEventListener("click", () => cloneJourneyIntoForm(btn.dataset.cloneJourneyId));
  });
}

// --- SE2L-67: clone an existing Journey as a starting point ---
// Loads a source journey's fields and phases into the create-journey form
// (reusing SE2L-64's addPhaseRow/handleJourneyFormSubmit) so the person just
// changes visa type/region/name and saves it as a brand-new journey. The
// duplicate guard in handleJourneyFormSubmit already stops them from
// accidentally saving an exact duplicate of the source.
async function cloneJourneyIntoForm(journeyId) {
  const { data: journey, error } = await supabaseClient
    .from("journeys")
    .select("*, phases(*)")
    .eq("id", journeyId)
    .single();

  if (error || !journey) {
    se2lToast(t("appmgr.clone_load_error_prefix") + (error?.message || t("common.not_found")), "error");
    return;
  }

  document.getElementById("journey-section").open = true;

  const visaSelect = document.getElementById("journey_visa_type");
  const otherInput = document.getElementById("journey_visa_type_other");
  const knownVisaTypes = Array.from(visaSelect.options).map(o => o.value).filter(v => v !== "other");

  if (knownVisaTypes.includes(journey.visa_type)) {
    visaSelect.value = journey.visa_type;
    otherInput.classList.add("hidden");
    otherInput.value = "";
  } else {
    visaSelect.value = "other";
    otherInput.value = journey.visa_type;
    otherInput.classList.remove("hidden");
  }

  document.getElementById("journey_uk_region").value = journey.uk_region;
  document.getElementById("journey_name").value = `${journey.name} (Copy)`;

  const phaseRowsDiv = document.getElementById("phase-rows");
  phaseRowsDiv.innerHTML = "";

  const sortedPhases = (journey.phases || []).slice().sort((a, b) => a.sort_order - b.sort_order);
  sortedPhases.forEach(p => addPhaseRow({
    name: p.name,
    start: p.days_after_arrival_start,
    end: p.days_after_arrival_end
  }));
  if (sortedPhases.length === 0) addPhaseRow();

  document.getElementById("journey-section").scrollIntoView({ behavior: "smooth", block: "start" });
  document.getElementById("journey_uk_region").focus();

  se2lToast(t("appmgr.clone_success", { name: journey.name, count: sortedPhases.length }), "success");
}

// --- SE2L-65: configure Phase time windows on an existing journey ---

function addPhaseEditRow(rowsDiv, phase) {
  const row = document.createElement("div");
  row.className = "flex gap-2 items-start";
  row.dataset.phaseId = phase?.id || "";
  row.innerHTML = `
    <input type="text" class="edit-phase-name flex-1 form-input" placeholder="${t("appmgr.phase_name_placeholder")}" value="${phase?.name || ""}" />
    <input type="number" class="edit-phase-start form-input" style="width:5rem;" placeholder="${t("appmgr.phase_from_placeholder")}" value="${phase?.days_after_arrival_start ?? ""}" />
    <input type="number" class="edit-phase-end form-input" style="width:5rem;" placeholder="${t("appmgr.phase_to_placeholder")}" value="${phase?.days_after_arrival_end ?? ""}" />
    <button type="button" class="remove-edit-phase-row-btn text-xs text-red-600 font-medium px-2 py-2">${t("common.remove")}</button>
  `;
  rowsDiv.appendChild(row);
  row.querySelector(".remove-edit-phase-row-btn").addEventListener("click", () => row.remove());
}

async function toggleJourneyPhaseEditor(journeyId) {
  const container = document.getElementById(`phase-editor-${journeyId}`);
  if (!container) return;

  // Toggle closed if already open
  if (!container.classList.contains("hidden")) {
    container.classList.add("hidden");
    container.innerHTML = "";
    return;
  }

  const { data: phases, error } = await supabaseClient
    .from("phases")
    .select("*")
    .eq("journey_id", journeyId)
    .order("sort_order", { ascending: true });

  if (error) {
    se2lToast(t("appmgr.phase_load_error_prefix") + error.message, "error");
    return;
  }

  container.innerHTML = `
    <div class="edit-phase-rows flex flex-col gap-2 mb-2"></div>
    <button type="button" class="add-edit-phase-row-btn text-xs text-indigo-600 font-medium">${t("appmgr.add_phase")}</button>
    <div class="flex justify-end gap-2 mt-3">
      <button type="button" class="cancel-phase-edit-btn btn btn-secondary btn-sm">${t("common.cancel")}</button>
      <button type="button" class="save-phase-edit-btn btn btn-primary btn-sm">${t("appmgr.save_phases")}</button>
    </div>
  `;
  container.classList.remove("hidden");

  const rowsDiv = container.querySelector(".edit-phase-rows");
  (phases || []).forEach(p => addPhaseEditRow(rowsDiv, p));
  if (!phases || phases.length === 0) addPhaseEditRow(rowsDiv, null);

  container.querySelector(".add-edit-phase-row-btn").addEventListener("click", () => addPhaseEditRow(rowsDiv, null));
  container.querySelector(".cancel-phase-edit-btn").addEventListener("click", () => {
    container.classList.add("hidden");
    container.innerHTML = "";
  });
  container.querySelector(".save-phase-edit-btn").addEventListener("click", () => savePhaseEdits(journeyId, rowsDiv));
}

async function savePhaseEdits(journeyId, rowsDiv) {
  const rows = Array.from(rowsDiv.children);

  if (rows.length === 0) {
    se2lToast(t("appmgr.needs_one_phase"), "error");
    return;
  }

  const parsed = rows.map(row => ({
    row,
    phaseId: row.dataset.phaseId || null,
    name: row.querySelector(".edit-phase-name").value.trim(),
    start: row.querySelector(".edit-phase-start").value,
    end: row.querySelector(".edit-phase-end").value
  }));

  for (const p of parsed) {
    if (!p.name || p.start === "" || p.end === "") {
      se2lToast(t("appmgr.phase_needs_fields"), "error");
      return;
    }
    if (Number(p.start) > Number(p.end)) {
      se2lToast(t("appmgr.phase_start_after_end", { name: p.name }), "error");
      return;
    }
  }

  // Non-blocking overlap warning — a newcomer's dashboard picks one phase per
  // day, so overlapping windows are usually a mistake, but not always.
  const byStart = [...parsed].sort((a, b) => Number(a.start) - Number(b.start));
  for (let i = 1; i < byStart.length; i++) {
    if (Number(byStart[i].start) <= Number(byStart[i - 1].end)) {
      const proceed = await se2lConfirm(t("appmgr.phase_overlap_warning", { name1: byStart[i - 1].name, name2: byStart[i].name }));
      if (!proceed) return;
      break;
    }
  }

  // Find which existing phases were removed from the form entirely
  const { data: existingPhases } = await supabaseClient
    .from("phases")
    .select("id")
    .eq("journey_id", journeyId);

  const existingIds = new Set((existingPhases || []).map(p => p.id));
  const keptIds = new Set(parsed.map(p => p.phaseId).filter(id => id));
  const removedIds = [...existingIds].filter(id => !keptIds.has(id));

  const blockedDeletions = [];
  for (const removedId of removedIds) {
    const { error: deleteError } = await supabaseClient.from("phases").delete().eq("id", removedId);
    if (deleteError) {
      blockedDeletions.push(removedId);
    }
  }

  for (let i = 0; i < parsed.length; i++) {
    const p = parsed[i];
    const payload = {
      name: p.name,
      days_after_arrival_start: Number(p.start),
      days_after_arrival_end: Number(p.end),
      sort_order: i
    };

    if (p.phaseId) {
      await supabaseClient.from("phases").update(payload).eq("id", p.phaseId);
    } else {
      await supabaseClient.from("phases").insert({ ...payload, journey_id: journeyId });
    }
  }

  if (blockedDeletions.length > 0) {
    se2lToast(t("appmgr.phases_saved_blocked", { count: blockedDeletions.length }), "error");
  } else {
    se2lToast(t("appmgr.phases_updated"), "success");
  }

  document.getElementById(`phase-editor-${journeyId}`).classList.add("hidden");
  document.getElementById(`phase-editor-${journeyId}`).innerHTML = "";
  await loadExistingJourneys();
  await loadPhaseOptions();
}

async function handleJourneyFormSubmit(e) {
  e.preventDefault();

  const visaTypeSelect = document.getElementById("journey_visa_type").value;
  const visaType = visaTypeSelect === "other"
    ? document.getElementById("journey_visa_type_other").value.trim()
    : visaTypeSelect;
  const ukRegion = document.getElementById("journey_uk_region").value;
  const name = document.getElementById("journey_name").value.trim();
  const phaseRows = collectPhaseRows();

  if (!visaType) {
    se2lToast(t("appmgr.specify_visa_type"), "error");
    return;
  }

  if (phaseRows.length === 0) {
    se2lToast(t("appmgr.needs_one_phase_journey"), "error");
    return;
  }

  for (const phase of phaseRows) {
    if (!phase.name || phase.days_after_arrival_start === "" || phase.days_after_arrival_end === "") {
      se2lToast(t("appmgr.phase_needs_fields"), "error");
      return;
    }
    if (Number(phase.days_after_arrival_start) > Number(phase.days_after_arrival_end)) {
      se2lToast(t("appmgr.phase_start_after_end", { name: phase.name }), "error");
      return;
    }
  }

  // Guard against a duplicate (visa_type, uk_region) journey — dashboard.js
  // does a .single() lookup on this exact combo and would break with two matches.
  const { data: existingJourney } = await supabaseClient
    .from("journeys")
    .select("id")
    .eq("visa_type", visaType)
    .eq("uk_region", ukRegion)
    .maybeSingle();

  if (existingJourney) {
    se2lToast(t("appmgr.duplicate_journey", { visaType: visaType.replace("_", " "), region: ukRegion.replace("_", " ") }), "error");
    return;
  }

  const { data: newJourney, error: journeyError } = await supabaseClient
    .from("journeys")
    .insert({ name, visa_type: visaType, uk_region: ukRegion })
    .select()
    .single();

  if (journeyError || !newJourney) {
    se2lToast(t("appmgr.journey_create_error_prefix") + (journeyError?.message || t("common.unknown_error")), "error");
    return;
  }

  const phaseInserts = phaseRows.map(p => ({
    journey_id: newJourney.id,
    name: p.name,
    days_after_arrival_start: Number(p.days_after_arrival_start),
    days_after_arrival_end: Number(p.days_after_arrival_end),
    sort_order: p.sort_order
  }));

  const { error: phaseError } = await supabaseClient.from("phases").insert(phaseInserts);

  if (phaseError) {
    se2lToast(t("appmgr.journey_phases_failed_prefix") + phaseError.message + " " + t("appmgr.journey_phases_failed_suffix"), "error");
  } else {
    se2lToast(t("appmgr.journey_created_with_phases", { count: phaseInserts.length }), "success");
  }

  resetJourneyForm();
  await loadExistingJourneys();
  await loadPhaseOptions(); // so the task form's phase dropdown includes the new journey's phases
}

async function loadPhaseOptions() {
  const { data: phases } = await supabaseClient
    .from("phases")
    .select("id, name, journey_id, journeys(visa_type)")
    .order("sort_order", { ascending: true });

  const seen = new Set();
  const phaseSelect = document.getElementById("phase_id");

  const uniquePhases = (phases || []).filter(p => {
    if (seen.has(p.name)) return false;
    seen.add(p.name);
    return true;
  });

  phaseSelect.innerHTML = uniquePhases
    .map(p => `<option value="${p.name}">${p.name}</option>`)
    .join("");
}

async function loadDependsOnOptions(excludeTaskId) {
  const { data: tasks } = await supabaseClient
    .from("tasks")
    .select("id, title")
    .neq("status", "archived")
    .order("title", { ascending: true });

  const dependsSelect = document.getElementById("depends_on");
  const available = (tasks || []).filter(t => t.id !== excludeTaskId);

  if (available.length === 0) {
    dependsSelect.innerHTML = `<option value="" disabled>${t("appmgr.no_other_tasks")}</option>`;
    return;
  }

  dependsSelect.innerHTML = available
    .map(t => `<option value="${t.id}">${t.title}</option>`)
    .join("");
}

function extractYouTubeId(url) {
  if (!url) return null;
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

// --- SE2L-63: content version audit trail helper ---
// Writes a snapshot row every time a task is created or changed, so App
// Managers (and Super Admins) can see a full history of edits.
async function recordTaskVersion(taskId, changeType, snapshot, previousStatus, newStatus, reviewNote) {
  const { error } = await supabaseClient.from("task_versions").insert({
    task_id: taskId,
    changed_by: currentUser.id,
    change_type: changeType,
    previous_status: previousStatus || null,
    new_status: newStatus || null,
    snapshot: snapshot,
    review_note: reviewNote || null
  });

  if (error) {
    // Don't block the main save flow if version logging fails — just warn.
    console.error("Could not record task version:", error);
  }
}

function syncUrgencyPills() {
  const currentValue = document.getElementById("urgency").value;
  document.querySelectorAll(".urgency-pill").forEach(btn => {
    btn.classList.toggle("is-selected", btn.dataset.urgencyValue === currentValue);
  });
}

document.querySelectorAll(".urgency-pill").forEach(btn => {
  btn.addEventListener("click", () => {
    document.getElementById("urgency").value = btn.dataset.urgencyValue;
    syncUrgencyPills();
  });
});

function syncSubmitButtonLabel() {
  const status = document.getElementById("status").value;
  const labels = {
    draft: t("appmgr.save_as_draft"),
    in_review: t("appmgr.submit_for_review"),
    published: t("appmgr.publish_task")
  };
  document.getElementById("submit-btn").textContent = labels[status] || t("common.save");
}

function resetForm() {
  document.getElementById("task-form").reset();
  document.getElementById("task_id").value = "";
  document.getElementById("form-heading").textContent = t("appmgr.create_task_heading");
  document.getElementById("status").value = "draft";
  syncSubmitButtonLabel();
  document.getElementById("cancel-edit-btn").classList.add("hidden");
  document.getElementById("region_england").checked = true;
  Array.from(document.getElementById("depends_on").options).forEach(opt => opt.selected = false);
  loadDependsOnOptions(null);
  syncUrgencyPills();
}

async function loadTaskForEdit(taskId) {
  const { data: task, error } = await supabaseClient
    .from("tasks")
    .select(`
      *,
      task_phases(phases(name)),
      task_visa_types(visa_type),
      task_uk_regions(uk_region),
      task_links(url),
      task_youtube_videos(youtube_video_id)
    `)
    .eq("id", taskId)
    .single();

  if (error || !task) {
    se2lToast(t("appmgr.task_load_error"), "error");
    return;
  }

  document.getElementById("task_id").value = task.id;
  document.getElementById("title").value = task.title;
  document.getElementById("body_html").value = task.body_html || "";
  document.getElementById("category").value = task.category || "Housing";
  document.getElementById("urgency").value = task.urgency;
  syncUrgencyPills();
  document.getElementById("time_estimate").value = task.time_estimate_minutes || "";
  document.getElementById("is_minor_task").checked = task.is_minor_task || false;
  document.getElementById("status").value = task.status || "draft";

  const scheduleInput = document.getElementById("scheduled_publish_at");
  if (task.scheduled_publish_at) {
    const dt = new Date(task.scheduled_publish_at);
    const pad = n => String(n).padStart(2, "0");
    scheduleInput.value = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  } else {
    scheduleInput.value = "";
  }

  const phaseName = task.task_phases?.[0]?.phases?.name;
  if (phaseName) document.getElementById("phase_id").value = phaseName;

  const visaTypes = (task.task_visa_types || []).map(v => v.visa_type);
  document.getElementById("visa_skilled_worker").checked = visaTypes.includes("skilled_worker");
  document.getElementById("visa_student").checked = visaTypes.includes("student");

  const regions = (task.task_uk_regions || []).map(r => r.uk_region);
  document.getElementById("region_england").checked = regions.includes("england");
  document.getElementById("region_scotland").checked = regions.includes("scotland");
  document.getElementById("region_wales").checked = regions.includes("wales");
  document.getElementById("region_northern_ireland").checked = regions.includes("northern_ireland");

  document.getElementById("link_url").value = task.task_links?.[0]?.url || "";
  document.getElementById("youtube_url").value = task.task_youtube_videos?.[0]?.youtube_video_id
    ? `https://youtube.com/watch?v=${task.task_youtube_videos[0].youtube_video_id}`
    : "";

  document.getElementById("form-heading").textContent = t("appmgr.edit_task_heading");
  syncSubmitButtonLabel();
  document.getElementById("cancel-edit-btn").classList.remove("hidden");

  await loadDependsOnOptions(task.id);

  const { data: existingDeps } = await supabaseClient
    .from("task_dependencies")
    .select("depends_on_task_id")
    .eq("task_id", task.id);

  const dependsOnIds = new Set((existingDeps || []).map(d => d.depends_on_task_id));
  Array.from(document.getElementById("depends_on").options).forEach(opt => {
    opt.selected = dependsOnIds.has(opt.value);
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function archiveTask(taskId) {
  if (!(await se2lConfirm(t("appmgr.archive_confirm"), { confirmLabel: "Archive", danger: true }))) return;
  await changeTaskStatus(taskId, "archived");
}

// --- SE2L-62: draft -> in_review -> published state transitions ---
// Handles moving a task through the review workflow, and logs every
// transition into task_versions (SE2L-63) so there's a full audit trail.
async function changeTaskStatus(taskId, newStatus, reviewNote) {
  const { data: existingTask, error: fetchError } = await supabaseClient
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .single();

  if (fetchError || !existingTask) {
    se2lToast(t("appmgr.task_status_load_error"), "error");
    return;
  }

  const previousStatus = existingTask.status;

  const { error: updateError } = await supabaseClient
    .from("tasks")
    .update({ status: newStatus })
    .eq("id", taskId);

  if (updateError) {
    se2lToast(t("appmgr.task_status_update_error_prefix") + updateError.message, "error");
    return;
  }

  await recordTaskVersion(
    taskId,
    "status_change",
    { ...existingTask, status: newStatus },
    previousStatus,
    newStatus,
    reviewNote
  );

  loadExistingTasks();
}

const statusBadgeStyles = {
  draft: "bg-slate-100 text-slate-600",
  in_review: "bg-amber-50 text-amber-700",
  published: "bg-green-50 text-green-700",
  archived: "bg-slate-100 text-slate-400"
};

const statusLabels = {
  draft: t("appmgr.status_draft_short"),
  in_review: t("appmgr.status_in_review"),
  published: t("appmgr.status_published_short"),
  archived: t("appmgr.status_archived")
};

function renderStatusActions(task) {
  const buttons = [];

  if (task.status === "draft") {
    buttons.push(`<button data-status-action="in_review" data-task-id="${task.id}" class="text-xs text-amber-700 font-medium">${t("appmgr.submit_for_review")}</button>`);
  }
  if (task.status === "in_review") {
    // Only Super Admin can publish — App Managers can submit for review
    // but cannot approve their own or anyone else's work. See the
    // SE2L-95 follow-up discussion: this is a deliberate governance
    // rule, not a bug, so it's checked by role rather than left open.
    if (currentUserRole === "super_admin") {
      buttons.push(`<button data-status-action="published" data-task-id="${task.id}" class="text-xs text-green-700 font-medium">${t("appmgr.publish")}</button>`);
      buttons.push(`<button data-status-action="draft" data-reject="true" data-task-id="${task.id}" class="text-xs text-slate-500 font-medium">${t("appmgr.send_back_to_draft")}</button>`);
    } else {
      buttons.push(`<span class="text-xs text-slate-400">${t("appmgr.awaiting_review")}</span>`);
    }
  }
  if (task.status === "published") {
    buttons.push(`<button data-status-action="draft" data-task-id="${task.id}" class="text-xs text-slate-500 font-medium">${t("appmgr.unpublish_to_draft")}</button>`);
  }

  return buttons.join("");
}

async function loadExistingTasks() {
  const listDiv = document.getElementById("task-list");
  listDiv.innerHTML = `<p class="text-sm text-slate-400">${t("appmgr.loading_tasks_option") || "Loading tasks..."}</p>`;

  // Same ordering source as loadPhaseOptions: phases deduped by name,
  // ordered by sort_order — that's the real day-progression order
  // (Pre-arrival, Arrival day, First week...), not alphabetical.
  // Neither query depends on the other's result, so they run in
  // parallel via Promise.all rather than one after another — this was
  // previously two sequential round-trips for no reason, which is the
  // actual cause of the visible delay before tasks appeared.
  const [{ data: allPhases }, { data: tasks }, { data: versionRows }] = await Promise.all([
    supabaseClient
      .from("phases")
      .select("name")
      .order("sort_order", { ascending: true }),
    supabaseClient
      .from("tasks")
      .select("*, task_phases(phases(name))")
      .order("created_at", { ascending: false }),
    // Rejection notes: pulled here so a draft task that was previously
    // sent back can show the reviewer's feedback inline, rather than
    // the App Manager having to dig through a separate history view.
    supabaseClient
      .from("task_versions")
      .select("task_id, review_note, created_at")
      .not("review_note", "is", null)
      .order("created_at", { ascending: false })
  ]);

  // Most recent review_note per task — since versionRows is already
  // ordered newest-first, the first one seen per task_id wins.
  const latestRejectionNoteByTask = {};
  (versionRows || []).forEach(v => {
    if (!latestRejectionNoteByTask[v.task_id]) {
      latestRejectionNoteByTask[v.task_id] = v.review_note;
    }
  });

  const seenPhaseNames = new Set();
  const orderedPhaseNames = (allPhases || []).filter(p => {
    if (seenPhaseNames.has(p.name)) return false;
    seenPhaseNames.add(p.name);
    return true;
  }).map(p => p.name);

  if (!tasks || tasks.length === 0) {
    listDiv.innerHTML = `<p class="text-sm text-slate-400">${t("appmgr.no_tasks_yet")}</p>`;
    return;
  }

  const reviewCountBadge = document.getElementById("review-count-badge");
  if (reviewCountBadge) {
    const inReviewCount = tasks.filter(t => t.status === "in_review").length;
    if (currentUserRole === "super_admin" && inReviewCount > 0) {
      reviewCountBadge.textContent = `${inReviewCount} ${inReviewCount === 1 ? t("appmgr.needs_review_singular") : t("appmgr.needs_review_plural")}`;
      reviewCountBadge.classList.remove("hidden");
    } else {
      reviewCountBadge.classList.add("hidden");
    }
  }

  const urgencyRank = { Critical: 0, Important: 1, Optional: 2 };

  // Group by phase name — same "same name across journeys" concept the
  // rest of this file already treats phases by (task creation, reorder).
  const groups = {};
  const UNASSIGNED = t("appmgr.no_phase_assigned");

  tasks.forEach(t => {
    const phaseName = t.task_phases?.[0]?.phases?.name || UNASSIGNED;
    if (!groups[phaseName]) groups[phaseName] = [];
    groups[phaseName].push(t);
  });

  const orderedGroupNames = [...orderedPhaseNames.filter(n => groups[n]), ...(groups[UNASSIGNED] ? [UNASSIGNED] : [])];

  listDiv.innerHTML = orderedGroupNames.map(phaseName => {
    const groupTasks = groups[phaseName].slice().sort((a, b) => {
      const rankA = urgencyRank[a.urgency] ?? 3;
      const rankB = urgencyRank[b.urgency] ?? 3;
      return rankA - rankB;
    });

    const rows = groupTasks.map(task => {
      const urgencyColor = { Critical: "var(--color-critical)", Important: "var(--color-warning)", Optional: "var(--color-text-muted)" };
      const rejectionNote = task.status === "draft" ? latestRejectionNoteByTask[task.id] : null;
      return `
      <div class="task-row ${task.status === "archived" ? "opacity-50" : ""}" style="border-left-color: ${urgencyColor[task.urgency] || "var(--color-border)"}">
        <div class="task-row-main">
          <p class="task-row-title">${task.title}${task.is_minor_task ? ` <span class="task-row-minor-tag">${t("appmgr.minor_tag")}</span>` : ""}</p>
          <div class="task-row-meta">
            <span class="task-status-pill ${statusBadgeStyles[task.status] || "bg-slate-100 text-slate-500"}">${statusLabels[task.status] || task.status}</span>
            <span class="task-row-meta-text">${task.urgency} · ${task.category || t("appmgr.uncategorised")}</span>
            ${task.scheduled_publish_at && task.status !== "published" ? `<span class="task-row-meta-text">· ${t("appmgr.scheduled_prefix")} ${new Date(task.scheduled_publish_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>` : ""}
          </div>
          ${rejectionNote ? `<p class="text-xs" style="color: var(--color-critical); margin-top: 0.35rem;">${t("appmgr.sent_back_prefix")} ${rejectionNote}</p>` : ""}
        </div>
        <div class="task-row-actions">
          ${renderStatusActions(task)}
          <a href="preview.html?task=${task.id}" target="_blank" class="task-row-action-link">${t("appmgr.preview")}</a>
          ${task.status !== "archived" ? `<button data-edit-id="${task.id}" class="task-row-action-link task-row-action-accent">${t("common.edit")}</button>` : ""}
          ${task.status !== "archived" ? `<button data-archive-id="${task.id}" class="task-row-action-link task-row-action-danger">${t("common.archive")}</button>` : ""}
        </div>
      </div>
    `;
    }).join("");

    return `
      <div class="task-phase-group">
        <p class="task-phase-group-heading">${phaseName}</p>
        <div class="flex flex-col gap-2">${rows}</div>
      </div>
    `;
  }).join("");

  listDiv.querySelectorAll("[data-edit-id]").forEach(btn => {
    btn.addEventListener("click", () => loadTaskForEdit(btn.dataset.editId));
  });

  listDiv.querySelectorAll("[data-archive-id]").forEach(btn => {
    btn.addEventListener("click", () => archiveTask(btn.dataset.archiveId));
  });

  listDiv.querySelectorAll("[data-status-action]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.dataset.reject === "true") {
        openRejectReasonModal(btn.dataset.taskId, btn.dataset.statusAction);
        return;
      }
      changeTaskStatus(btn.dataset.taskId, btn.dataset.statusAction);
    });
  });
}

// --- SE2L-95 follow-up: in-app rejection reason modal ---
// Replaces the native window.prompt() dialog, which looked out of place
// next to the rest of the styled UI. Tracks which task/status the modal
// is currently open for, so Confirm knows what to act on.
let pendingRejectTaskId = null;
let pendingRejectNewStatus = null;

function openRejectReasonModal(taskId, newStatus) {
  pendingRejectTaskId = taskId;
  pendingRejectNewStatus = newStatus;
  const modal = document.getElementById("reject-reason-modal");
  const input = document.getElementById("reject-reason-input");
  const errorEl = document.getElementById("reject-reason-error");
  if (input) input.value = "";
  if (errorEl) errorEl.classList.add("hidden");
  if (modal) modal.style.display = "flex";
  input?.focus();
}

function closeRejectReasonModal() {
  const modal = document.getElementById("reject-reason-modal");
  if (modal) modal.style.display = "none";
  pendingRejectTaskId = null;
  pendingRejectNewStatus = null;
}

document.getElementById("reject-reason-cancel")?.addEventListener("click", closeRejectReasonModal);

document.getElementById("reject-reason-input")?.addEventListener("input", () => {
  document.getElementById("reject-reason-error")?.classList.add("hidden");
});

// Clicking the dark overlay outside the card also cancels, same as
// clicking Cancel — standard modal behavior.
document.getElementById("reject-reason-modal")?.addEventListener("click", (e) => {
  if (e.target.id === "reject-reason-modal") closeRejectReasonModal();
});

document.getElementById("reject-reason-confirm")?.addEventListener("click", () => {
  const input = document.getElementById("reject-reason-input");
  const errorEl = document.getElementById("reject-reason-error");
  const reason = input?.value.trim();

  if (!reason) {
    errorEl?.classList.remove("hidden");
    input?.focus();
    return;
  }

  const taskId = pendingRejectTaskId;
  const newStatus = pendingRejectNewStatus;
  closeRejectReasonModal();
  changeTaskStatus(taskId, newStatus, reason);
});

async function handleFormSubmit(e) {
  e.preventDefault();

  const taskId = document.getElementById("task_id").value;
  const title = document.getElementById("title").value;
  const bodyHtml = document.getElementById("body_html").value;
  const category = document.getElementById("category").value;
  const urgency = document.getElementById("urgency").value;
  const timeEstimate = document.getElementById("time_estimate").value || null;
  const phaseName = document.getElementById("phase_id").value;
  const isMinorTask = document.getElementById("is_minor_task").checked;
  const status = document.getElementById("status").value;
  const scheduledPublishAtValue = document.getElementById("scheduled_publish_at").value;
  const scheduledPublishAt = scheduledPublishAtValue ? new Date(scheduledPublishAtValue).toISOString() : null;
  const linkUrl = document.getElementById("link_url").value;
  const youtubeUrl = document.getElementById("youtube_url").value;
  const youtubeId = extractYouTubeId(youtubeUrl);
  const dependsOnIds = Array.from(document.getElementById("depends_on").selectedOptions)
    .map(opt => opt.value)
    .filter(v => v);

  const visaTypes = [];
  if (document.getElementById("visa_skilled_worker").checked) visaTypes.push("skilled_worker");
  if (document.getElementById("visa_student").checked) visaTypes.push("student");

  const regions = [];
  if (document.getElementById("region_england").checked) regions.push("england");
  if (document.getElementById("region_scotland").checked) regions.push("scotland");
  if (document.getElementById("region_wales").checked) regions.push("wales");
  if (document.getElementById("region_northern_ireland").checked) regions.push("northern_ireland");

  if (!phaseName || visaTypes.length === 0 || regions.length === 0) {
    se2lToast(t("appmgr.select_phase_visa_region"), "error");
    return;
  }

  let taskRowId = taskId;
  let previousStatus = null;

  if (taskId) {
    const { data: taskBeforeUpdate } = await supabaseClient
      .from("tasks")
      .select("status")
      .eq("id", taskId)
      .single();
    previousStatus = taskBeforeUpdate ? taskBeforeUpdate.status : null;

    const { error: updateError } = await supabaseClient
      .from("tasks")
      .update({
        title,
        body_html: bodyHtml || null,
        category,
        urgency,
        time_estimate_minutes: timeEstimate,
        is_minor_task: isMinorTask,
        status,
        scheduled_publish_at: scheduledPublishAt
      })
      .eq("id", taskId);

    if (updateError) {
      se2lToast(t("appmgr.task_update_error_prefix") + updateError.message, "error");
      return;
    }

    await supabaseClient.from("task_phases").delete().eq("task_id", taskId);
    await supabaseClient.from("task_visa_types").delete().eq("task_id", taskId);
    await supabaseClient.from("task_uk_regions").delete().eq("task_id", taskId);
    await supabaseClient.from("task_links").delete().eq("task_id", taskId);
    await supabaseClient.from("task_youtube_videos").delete().eq("task_id", taskId);
    await supabaseClient.from("task_dependencies").delete().eq("task_id", taskId);
  } else {
    const { data: newTask, error: taskError } = await supabaseClient
      .from("tasks")
      .insert({
        title,
        body_html: bodyHtml || null,
        category,
        urgency,
        time_estimate_minutes: timeEstimate,
        is_minor_task: isMinorTask,
        status: status || "draft",
        scheduled_publish_at: scheduledPublishAt,
        created_by: currentUser.id
      })
      .select()
      .single();

    if (taskError) {
      se2lToast(t("appmgr.task_create_error_prefix") + taskError.message, "error");
      return;
    }

    taskRowId = newTask.id;
  }

  const { data: matchingPhases } = await supabaseClient
    .from("phases")
    .select("id")
    .eq("name", phaseName);

  if (matchingPhases && matchingPhases.length > 0) {
    const phaseLinks = matchingPhases.map(p => ({ task_id: taskRowId, phase_id: p.id }));
    await supabaseClient.from("task_phases").insert(phaseLinks);
  }

  const visaLinks = visaTypes.map(v => ({ task_id: taskRowId, visa_type: v }));
  await supabaseClient.from("task_visa_types").insert(visaLinks);

  const regionLinks = regions.map(r => ({ task_id: taskRowId, uk_region: r }));
  await supabaseClient.from("task_uk_regions").insert(regionLinks);

  if (linkUrl) {
    await supabaseClient.from("task_links").insert({ task_id: taskRowId, label: "More info", url: linkUrl });
  }

  if (youtubeId) {
    await supabaseClient.from("task_youtube_videos").insert({ task_id: taskRowId, youtube_video_id: youtubeId });
  }

  if (dependsOnIds.length > 0) {
    const dependencyLinks = dependsOnIds.map(depId => ({ task_id: taskRowId, depends_on_task_id: depId }));
    await supabaseClient.from("task_dependencies").insert(dependencyLinks);
  }

  // SE2L-63: log this save as a version, with the full final state as the snapshot
  const { data: finalTaskState } = await supabaseClient
    .from("tasks")
    .select("*")
    .eq("id", taskRowId)
    .single();

  await recordTaskVersion(
    taskRowId,
    taskId ? "updated" : "created",
    finalTaskState || { id: taskRowId, title, status },
    previousStatus,
    status
  );

  se2lToast(taskId ? t("appmgr.task_saved") : t("appmgr.task_created_as", { status: statusLabels[status || "draft"] }), "success");
  resetForm();
  loadExistingTasks();
}

// --- SE2L-66: reorder tasks within a Phase ---
// Grouped by urgency tier, matching dashboard.js's actual sort (urgency
// tier first, sort_order as tiebreak within a tier). Reordering only ever
// happens *within* one tier's list here, so what an App Manager does in
// this UI can never silently fail to matter on the real dashboard.

let currentReorderGroups = { Critical: [], Important: [], Optional: [] };
let currentReorderPhaseIds = [];

async function loadReorderPhaseOptions() {
  const { data: phases } = await supabaseClient
    .from("phases")
    .select("name")
    .order("name", { ascending: true });

  const seen = new Set();
  const uniqueNames = (phases || [])
    .filter(p => {
      if (seen.has(p.name)) return false;
      seen.add(p.name);
      return true;
    })
    .map(p => p.name);

  const select = document.getElementById("reorder_phase_select");

  if (uniqueNames.length === 0) {
    select.innerHTML = `<option value="">${t("appmgr.no_phases_yet")}</option>`;
    return;
  }

  select.innerHTML = `<option value="">${t("appmgr.select_a_phase")}</option>` +
    uniqueNames.map(n => `<option value="${n}">${n}</option>`).join("");
}

async function loadTasksForReorder(phaseName) {
  const listDiv = document.getElementById("reorder-task-list");
  const saveBtn = document.getElementById("save-task-order-btn");

  currentReorderGroups = { Critical: [], Important: [], Optional: [] };
  currentReorderPhaseIds = [];

  if (!phaseName) {
    listDiv.innerHTML = `<p class="text-sm text-slate-400">${t("appmgr.select_a_phase_prompt")}</p>`;
    saveBtn.classList.add("hidden");
    return;
  }

  const { data: phaseRows } = await supabaseClient
    .from("phases")
    .select("id")
    .eq("name", phaseName);

  currentReorderPhaseIds = (phaseRows || []).map(p => p.id);

  if (currentReorderPhaseIds.length === 0) {
    listDiv.innerHTML = `<p class="text-sm text-slate-400">${t("appmgr.no_phases_found")}</p>`;
    saveBtn.classList.add("hidden");
    return;
  }

  // Every phase sharing this name gets the same tasks assigned (see
  // handleFormSubmit), so the first matching phase id is a representative
  // sample of the task set and its ordering.
  const { data: taskLinks, error } = await supabaseClient
    .from("task_phases")
    .select("task_id, sort_order, tasks(id, title, urgency, status)")
    .eq("phase_id", currentReorderPhaseIds[0])
    .order("sort_order", { ascending: true });

  if (error) {
    listDiv.innerHTML = `<p class="text-sm text-red-600">${t("appmgr.reorder_load_error_prefix")}${error.message}</p>`;
    saveBtn.classList.add("hidden");
    return;
  }

  const tasks = (taskLinks || []).map(l => l.tasks).filter(task => task && task.status !== "archived");

  if (tasks.length === 0) {
    listDiv.innerHTML = `<p class="text-sm text-slate-400">${t("appmgr.no_tasks_in_phase")}</p>`;
    saveBtn.classList.add("hidden");
    return;
  }

  currentReorderGroups = {
    Critical: tasks.filter(t => t.urgency === "Critical"),
    Important: tasks.filter(t => t.urgency === "Important"),
    Optional: tasks.filter(t => t.urgency === "Optional")
  };

  renderReorderGroups();
}

function renderReorderGroups() {
  const listDiv = document.getElementById("reorder-task-list");
  const saveBtn = document.getElementById("save-task-order-btn");

  const tierBadgeStyles = {
    Critical: "bg-red-50 text-red-600",
    Important: "bg-amber-50 text-amber-700",
    Optional: "bg-slate-100 text-slate-500"
  };

  const tiers = ["Critical", "Important", "Optional"];
  const hasAnyTasks = tiers.some(t => currentReorderGroups[t].length > 0);

  if (!hasAnyTasks) {
    listDiv.innerHTML = `<p class="text-sm text-slate-400">${t("appmgr.no_tasks_in_phase")}</p>`;
    saveBtn.classList.add("hidden");
    return;
  }

  listDiv.innerHTML = tiers.map(tier => {
    const group = currentReorderGroups[tier];
    if (group.length === 0) return "";

    const rows = group.map((t, i) => `
      <div class="reorder-row">
        <span class="reorder-row-index">${i + 1}</span>
        <span class="reorder-row-title">${t.title}</span>
        <div class="reorder-row-controls">
          <button type="button" data-tier="${tier}" data-move="up" data-index="${i}" class="reorder-move-btn" ${i === 0 ? "disabled" : ""}>↑</button>
          <button type="button" data-tier="${tier}" data-move="down" data-index="${i}" class="reorder-move-btn" ${i === group.length - 1 ? "disabled" : ""}>↓</button>
        </div>
      </div>
    `).join("");

    return `
      <div class="reorder-tier-group">
        <span class="reorder-tier-badge ${tierBadgeStyles[tier] || "bg-slate-100 text-slate-500"}">${tier}</span>
        <div class="flex flex-col gap-1 mt-2">${rows}</div>
      </div>
    `;
  }).join("");

  saveBtn.classList.remove("hidden");

  listDiv.querySelectorAll("[data-move]").forEach(btn => {
    btn.addEventListener("click", () => {
      const tier = btn.dataset.tier;
      const index = Number(btn.dataset.index);
      const direction = btn.dataset.move;
      const swapWith = direction === "up" ? index - 1 : index + 1;
      const group = currentReorderGroups[tier];
      if (swapWith < 0 || swapWith >= group.length) return;
      [group[index], group[swapWith]] = [group[swapWith], group[index]];
      renderReorderGroups();
    });
  });
}

async function saveTaskOrder() {
  if (currentReorderPhaseIds.length === 0) return;

  const updates = [];
  ["Critical", "Important", "Optional"].forEach(tier => {
    currentReorderGroups[tier].forEach((task, index) => {
      currentReorderPhaseIds.forEach(phaseId => {
        updates.push(
          supabaseClient
            .from("task_phases")
            .update({ sort_order: index })
            .eq("phase_id", phaseId)
            .eq("task_id", task.id)
        );
      });
    });
  });

  const results = await Promise.all(updates);
  const failed = results.filter(r => r.error);

  se2lToast(
    failed.length > 0 ? t("appmgr.order_save_partial_fail", { count: failed.length }) : t("appmgr.order_saved"),
    failed.length > 0 ? "error" : "success"
  );
}


// --- SE2L-74: load active visa types and UK regions for the journey form ---
async function loadJourneyVisaTypeAndRegionOptions() {
  const [visaTypesResult, regionsResult] = await Promise.all([
    supabaseClient.from("available_visa_types").select("value, label").eq("is_active", true).order("sort_order", { ascending: true }),
    supabaseClient.from("available_uk_regions").select("value, label").eq("is_active", true).order("sort_order", { ascending: true })
  ]);

  const visaSelect = document.getElementById("journey_visa_type");
  const regionSelect = document.getElementById("journey_uk_region");

  const visaOptionsHtml = (visaTypesResult.data || []).map(v => `<option value="${v.value}">${v.label}</option>`).join("");
  visaSelect.innerHTML = visaOptionsHtml + `<option value="other">${t("appmgr.other_specify")}</option>`;

  regionSelect.innerHTML = (regionsResult.data || []).map(r => `<option value="${r.value}">${r.label}</option>`).join("")
    || `<option value="">${t("appmgr.no_regions_configured")}</option>`;
}

// SE2L-68/69/70/71: Analytics — computed client-side from the same tables
// and phase-detection logic dashboard.js already uses per-user (arrival
// date + phase day windows), not a simplified approximation. SE2L-72
// (email open/click rates) is deliberately NOT included here — there's
// no tracking data source for it yet (see the panel's own note).
let analyticsLoaded = false;

async function loadAnalytics() {
  if (analyticsLoaded) return;
  analyticsLoaded = true;

  const [usersRes, journeysRes, phasesRes, tasksRes, taskPhasesRes, taskVisaRes, taskRegionRes, completionsRes, feedbackRes] = await Promise.all([
    supabaseClient.from("users").select("id, visa_type, uk_region, arrival_date, role"),
    supabaseClient.from("journeys").select("id, visa_type, uk_region"),
    supabaseClient.from("phases").select("id, journey_id, name, days_after_arrival_start, days_after_arrival_end, sort_order"),
    supabaseClient.from("tasks").select("id, title").eq("status", "published"),
    supabaseClient.from("task_phases").select("task_id, phase_id"),
    supabaseClient.from("task_visa_types").select("task_id, visa_type"),
    supabaseClient.from("task_uk_regions").select("task_id, uk_region"),
    supabaseClient.from("user_task_state").select("user_id, task_id, status").eq("status", "complete"),
    supabaseClient.from("task_feedback").select("task_id, is_helpful")
  ]);

  // Regular newcomers only — excludes staff by their actual role value.
  // (Not a null/blank check: this schema defaults regular users' role to
  // "primary" rather than leaving it null, so filtering on falsiness was
  // wrongly excluding every real newcomer from these counts.)
  const users = (usersRes.data || []).filter(u => u.role !== "app_manager" && u.role !== "super_admin");
  const journeys = journeysRes.data || [];
  const phases = phasesRes.data || [];
  const tasks = tasksRes.data || [];
  const completions = new Set((completionsRes.data || []).map(c => c.user_id + "::" + c.task_id));
  const feedback = feedbackRes.data || [];

  const phaseById = Object.fromEntries(phases.map(p => [p.id, p]));
  const journeyByKey = Object.fromEntries(journeys.map(j => [j.visa_type + "::" + j.uk_region, j]));
  const phasesByJourney = {};
  phases.forEach(p => { (phasesByJourney[p.journey_id] ||= []).push(p); });
  Object.values(phasesByJourney).forEach(arr => arr.sort((a, b) => a.sort_order - b.sort_order));

  const taskVisaTypes = {};
  (taskVisaRes.data || []).forEach(l => { (taskVisaTypes[l.task_id] ||= []).push(l.visa_type); });
  const taskRegions = {};
  (taskRegionRes.data || []).forEach(l => { (taskRegions[l.task_id] ||= []).push(l.uk_region); });
  const taskPhaseIds = {};
  (taskPhasesRes.data || []).forEach(l => { (taskPhaseIds[l.task_id] ||= []).push(l.phase_id); });

  // Per-user: their journey, current phase, and days since arrival —
  // identical logic to dashboard.js's own phase-timeline calculation,
  // just run here for every user instead of just the signed-in one.
  const userInfo = users.map(u => {
    const journey = journeyByKey[u.visa_type + "::" + u.uk_region];
    if (!journey || !u.arrival_date) return null;
    const journeyPhases = phasesByJourney[journey.id] || [];
    const arrival = new Date(u.arrival_date);
    const today = new Date();
    const daysSince = Math.floor((today - arrival) / (1000 * 60 * 60 * 24));
    const currentPhase = journeyPhases.find(p => daysSince >= p.days_after_arrival_start && daysSince < p.days_after_arrival_end);
    const currentSortOrder = currentPhase ? currentPhase.sort_order : (journeyPhases.length ? journeyPhases[journeyPhases.length - 1].sort_order + 1 : 0);
    return { id: u.id, visa_type: u.visa_type, uk_region: u.uk_region, journeyPhases, currentPhase, currentSortOrder };
  }).filter(Boolean);

  // ---- SE2L-71: active users by journey & phase ----
  const activeCounts = {};
  userInfo.forEach(u => {
    const phaseName = u.currentPhase ? u.currentPhase.name : "Past all phases";
    const key = `${u.visa_type}|${u.uk_region}|${phaseName}`;
    activeCounts[key] = (activeCounts[key] || 0) + 1;
  });

  // ---- SE2L-68: completion rates by phase & visa type ----
  // "Eligible" = task's visa/region tags match the user, AND the task's
  // phase (matched by name against the user's own journey) is at or
  // before the user's current phase — i.e. they should have reached it.
  const completionAgg = {};
  userInfo.forEach(u => {
    tasks.forEach(t => {
      if (!(taskVisaTypes[t.id] || []).includes(u.visa_type)) return;
      if (!(taskRegions[t.id] || []).includes(u.uk_region)) return;
      const linkedPhaseNames = new Set((taskPhaseIds[t.id] || []).map(pid => phaseById[pid]?.name).filter(Boolean));
      const userPhaseForTask = u.journeyPhases.find(p => linkedPhaseNames.has(p.name));
      if (!userPhaseForTask) return;
      if (userPhaseForTask.sort_order > u.currentSortOrder) return;

      const key = `${u.visa_type}|${userPhaseForTask.name}`;
      completionAgg[key] ||= { eligible: 0, completed: 0, sortOrder: userPhaseForTask.sort_order, visaType: u.visa_type, phaseName: userPhaseForTask.name };
      completionAgg[key].eligible++;
      if (completions.has(u.id + "::" + t.id)) completionAgg[key].completed++;
    });
  });

  const completionRows = Object.values(completionAgg).sort((a, b) =>
    a.visaType.localeCompare(b.visaType) || a.sortOrder - b.sortOrder
  );

  // ---- SE2L-69: drop-off points ----
  // Biggest fall in completion % from one phase to the next-in-order
  // phase, within the same visa type.
  const dropoffRows = [];
  const byVisaType = {};
  completionRows.forEach(r => { (byVisaType[r.visaType] ||= []).push(r); });
  Object.entries(byVisaType).forEach(([visaType, rows]) => {
    for (let i = 1; i < rows.length; i++) {
      const prevRate = rows[i - 1].eligible ? rows[i - 1].completed / rows[i - 1].eligible : 0;
      const currRate = rows[i].eligible ? rows[i].completed / rows[i].eligible : 0;
      const drop = prevRate - currRate;
      if (drop > 0) {
        dropoffRows.push({ visaType, from: rows[i - 1].phaseName, to: rows[i].phaseName, drop, prevRate, currRate });
      }
    }
  });
  dropoffRows.sort((a, b) => b.drop - a.drop);

  // ---- SE2L-70: feedback ratings per task ----
  const feedbackAgg = {};
  feedback.forEach(f => {
    feedbackAgg[f.task_id] ||= { up: 0, down: 0 };
    if (f.is_helpful === true) feedbackAgg[f.task_id].up++;
    else if (f.is_helpful === false) feedbackAgg[f.task_id].down++;
  });
  const taskTitleById = Object.fromEntries(tasks.map(t => [t.id, t.title]));
  const feedbackRows = Object.entries(feedbackAgg)
    .map(([taskId, counts]) => ({ title: taskTitleById[taskId] || t("appmgr.analytics_unknown_task"), ...counts, total: counts.up + counts.down }))
    .filter(r => r.total > 0)
    .sort((a, b) => b.total - a.total);

  renderAnalyticsSummary(users.length, completionRows, feedbackRows);
  renderActiveUsers(activeCounts);
  renderCompletionRates(completionRows);
  renderDropoff(dropoffRows);
  renderFeedback(feedbackRows);
}

function renderAnalyticsSummary(totalUsers, completionRows, feedbackRows) {
  const el = document.getElementById("analytics-summary-cards");
  const totalEligible = completionRows.reduce((s, r) => s + r.eligible, 0);
  const totalCompleted = completionRows.reduce((s, r) => s + r.completed, 0);
  const overallRate = totalEligible ? Math.round((totalCompleted / totalEligible) * 100) : 0;
  const totalFeedback = feedbackRows.reduce((s, r) => s + r.total, 0);

  el.innerHTML = `
    <div class="admin-stat-card">
      <p class="admin-stat-label">${t("appmgr.analytics_stat_users")}</p>
      <p class="admin-stat-value">${totalUsers}</p>
    </div>
    <div class="admin-stat-card">
      <p class="admin-stat-label">${t("appmgr.analytics_stat_overall_completion")}</p>
      <p class="admin-stat-value">${overallRate}%</p>
    </div>
    <div class="admin-stat-card">
      <p class="admin-stat-label">${t("appmgr.analytics_stat_feedback_count")}</p>
      <p class="admin-stat-value">${totalFeedback}</p>
    </div>
  `;
}

function renderActiveUsers(activeCounts) {
  const el = document.getElementById("analytics-active-users");
  const rows = Object.entries(activeCounts).sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) {
    el.innerHTML = `<p class="text-slate-400">${t("appmgr.analytics_no_data")}</p>`;
    return;
  }
  el.innerHTML = `
    <table class="w-full text-sm">
      <thead><tr class="text-left text-slate-500 border-b" style="border-color: var(--color-border);">
        <th class="pb-2">${t("appmgr.visa_type_label")}</th>
        <th class="pb-2">${t("appmgr.uk_region_label")}</th>
        <th class="pb-2">${t("appmgr.phase_label")}</th>
        <th class="pb-2 text-right">${t("appmgr.analytics_users_col")}</th>
      </tr></thead>
      <tbody>
        ${rows.map(([key, count]) => {
          const [visaType, region, phaseName] = key.split("|");
          return `<tr class="border-b" style="border-color: var(--color-border);">
            <td class="py-2">${visaType}</td>
            <td class="py-2">${region}</td>
            <td class="py-2">${phaseName}</td>
            <td class="py-2 text-right font-medium">${count}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  `;
}

function renderCompletionRates(rows) {
  const el = document.getElementById("analytics-completion");
  if (rows.length === 0) {
    el.innerHTML = `<p class="text-slate-400">${t("appmgr.analytics_no_data")}</p>`;
    return;
  }
  el.innerHTML = `
    <table class="w-full text-sm">
      <thead><tr class="text-left text-slate-500 border-b" style="border-color: var(--color-border);">
        <th class="pb-2">${t("appmgr.visa_type_label")}</th>
        <th class="pb-2">${t("appmgr.phase_label")}</th>
        <th class="pb-2 text-right">${t("appmgr.analytics_completed_col")}</th>
        <th class="pb-2 text-right">${t("appmgr.analytics_rate_col")}</th>
      </tr></thead>
      <tbody>
        ${rows.map(r => {
          const pct = r.eligible ? Math.round((r.completed / r.eligible) * 100) : 0;
          return `<tr class="border-b" style="border-color: var(--color-border);">
            <td class="py-2">${r.visaType}</td>
            <td class="py-2">${r.phaseName}</td>
            <td class="py-2 text-right">${r.completed} / ${r.eligible}</td>
            <td class="py-2 text-right font-medium">${pct}%</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  `;
}

function renderDropoff(rows) {
  const el = document.getElementById("analytics-dropoff");
  if (rows.length === 0) {
    el.innerHTML = `<p class="text-slate-400">${t("appmgr.analytics_no_dropoff")}</p>`;
    return;
  }
  el.innerHTML = rows.slice(0, 5).map((r, i) => `
    <div class="flex justify-between items-center py-2 ${i > 0 ? "border-t" : ""}" style="border-color: var(--color-border);">
      <div>
        <span class="text-xs text-indigo-600 font-medium">${r.visaType}</span>
        <p class="text-sm font-medium mt-0.5">${r.from} \u2192 ${r.to}</p>
      </div>
      <span class="text-sm font-medium" style="color: var(--color-critical);">-${Math.round(r.drop * 100)}pp</span>
    </div>
  `).join("");
}

function renderFeedback(rows) {
  const el = document.getElementById("analytics-feedback");
  if (rows.length === 0) {
    el.innerHTML = `<p class="text-slate-400">${t("appmgr.analytics_no_feedback")}</p>`;
    return;
  }
  el.innerHTML = `
    <table class="w-full text-sm">
      <thead><tr class="text-left text-slate-500 border-b" style="border-color: var(--color-border);">
        <th class="pb-2">${t("appmgr.title_label")}</th>
        <th class="pb-2 text-right">\uD83D\uDC4D</th>
        <th class="pb-2 text-right">\uD83D\uDC4E</th>
      </tr></thead>
      <tbody>
        ${rows.map(r => `<tr class="border-b" style="border-color: var(--color-border);">
          <td class="py-2">${r.title}</td>
          <td class="py-2 text-right" style="color: var(--color-success-dark);">${r.up}</td>
          <td class="py-2 text-right" style="color: var(--color-critical);">${r.down}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  `;
}

// Sidebar section-switching — shows one of Journeys/Tasks/Reorder/Analytics
// at a time instead of stacking all four on one long page. Purely a display
// toggle; every section's data still loads on page load same as before,
// except Analytics which lazy-loads on first click (see loadAnalytics).
function setupPanelSwitching() {
  const subnavLinks = document.querySelectorAll(".sidebar-subnav [data-panel-target]");

  subnavLinks.forEach(link => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const targetId = link.dataset.panelTarget;

      document.querySelectorAll(".app-manager-panel").forEach(panel => {
        panel.classList.toggle("is-active-panel", panel.id === targetId);
      });

      subnavLinks.forEach(l => l.classList.toggle("is-active-subnav", l === link));

      if (targetId === "panel-analytics") {
        loadAnalytics();
      }
    });
  });
}

async function init() {
  const user = await checkAppManagerAccess();
  if (!user) return;
  currentUser = user;

  setupPanelSwitching();

  await loadJourneyVisaTypeAndRegionOptions();
  await loadPhaseOptions();
  await loadDependsOnOptions(null);
  await loadExistingTasks();
  await loadExistingJourneys();

  addPhaseRow();
  addPhaseRow();

  syncUrgencyPills();
  syncSubmitButtonLabel();
  document.getElementById("status").addEventListener("change", syncSubmitButtonLabel);

  document.getElementById("task-form").addEventListener("submit", handleFormSubmit);
  document.getElementById("cancel-edit-btn").addEventListener("click", resetForm);

  document.getElementById("journey-form").addEventListener("submit", handleJourneyFormSubmit);
  document.getElementById("add-phase-row-btn").addEventListener("click", () => addPhaseRow());
  document.getElementById("journey_visa_type").addEventListener("change", (e) => {
    document.getElementById("journey_visa_type_other").classList.toggle("hidden", e.target.value !== "other");
  });

  await loadReorderPhaseOptions();
  document.getElementById("reorder_phase_select").addEventListener("change", (e) => loadTasksForReorder(e.target.value));
  document.getElementById("save-task-order-btn").addEventListener("click", saveTaskOrder);

  setupRealtimeTaskSync();
}

// --- SE2L-95 follow-up: keep the task list in sync across sessions ---
// Without this, a Super Admin reviewing in one browser/window and an
// App Manager working in another would each see a stale list until they
// manually refresh — which is exactly the gap that made the rejection
// reason "invisible" until a manual reload. Debounced since a single
// action (e.g. reject) can trigger both a tasks update and a
// task_versions insert in quick succession, which would otherwise
// double-fetch.
let realtimeSyncTimeout = null;
function scheduleTaskListRefresh() {
  clearTimeout(realtimeSyncTimeout);
  realtimeSyncTimeout = setTimeout(() => {
    loadExistingTasks();
  }, 400);
}

function setupRealtimeTaskSync() {
  supabaseClient
    .channel("app-manager-task-sync")
    .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, scheduleTaskListRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "task_versions" }, scheduleTaskListRefresh)
    .subscribe();
}

init();