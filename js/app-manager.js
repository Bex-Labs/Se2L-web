let currentUser = null;

async function checkAppManagerAccess() {
  const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

  if (authError || !user) {
    window.location.href = "onboarding.html";
    return null;
  }

  const { data: profile } = await supabaseClient
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "app_manager") {
    document.querySelector(".max-w-2xl").innerHTML = `
      <p class="text-sm text-red-600 mt-10">You don't have access to this page.</p>
    `;
    return null;
  }

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
    <input type="text" class="phase-name flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. First week" value="${prefill?.name || ""}" />
    <input type="number" class="phase-start w-20 border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="From" value="${prefill?.start ?? ""}" />
    <input type="number" class="phase-end w-20 border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="To" value="${prefill?.end ?? ""}" />
    <button type="button" class="remove-phase-row-btn text-xs text-red-600 font-medium px-2 py-2" data-row-id="${rowId}">Remove</button>
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
    listDiv.innerHTML = `<p class="text-sm text-slate-400">No journeys created yet.</p>`;
    return;
  }

  listDiv.innerHTML = journeys.map(j => `
    <div class="bg-slate-50 border border-slate-200 rounded-lg p-3" id="journey-card-${j.id}">
      <div class="flex justify-between items-center">
        <div>
          <p class="text-sm font-medium">${j.name}</p>
          <p class="text-xs text-slate-500 mt-0.5">
            ${j.visa_type.replace("_", " ")} · ${j.uk_region.replace("_", " ")} · ${j.phases?.length || 0} phase${j.phases?.length === 1 ? "" : "s"}
          </p>
        </div>
        <button data-edit-journey-id="${j.id}" class="text-xs text-indigo-600 font-medium">Edit phases</button>
      </div>
      <div id="phase-editor-${j.id}" class="hidden mt-3 pt-3 border-t border-slate-200"></div>
    </div>
  `).join("");

  listDiv.querySelectorAll("[data-edit-journey-id]").forEach(btn => {
    btn.addEventListener("click", () => toggleJourneyPhaseEditor(btn.dataset.editJourneyId));
  });
}

// --- SE2L-65: configure Phase time windows on an existing journey ---

function addPhaseEditRow(rowsDiv, phase) {
  const row = document.createElement("div");
  row.className = "flex gap-2 items-start";
  row.dataset.phaseId = phase?.id || "";
  row.innerHTML = `
    <input type="text" class="edit-phase-name flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. First week" value="${phase?.name || ""}" />
    <input type="number" class="edit-phase-start w-20 border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="From" value="${phase?.days_after_arrival_start ?? ""}" />
    <input type="number" class="edit-phase-end w-20 border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="To" value="${phase?.days_after_arrival_end ?? ""}" />
    <button type="button" class="remove-edit-phase-row-btn text-xs text-red-600 font-medium px-2 py-2">Remove</button>
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
    alert("Could not load phases for this journey: " + error.message);
    return;
  }

  container.innerHTML = `
    <div class="edit-phase-rows flex flex-col gap-2 mb-2"></div>
    <button type="button" class="add-edit-phase-row-btn text-xs text-indigo-600 font-medium">+ Add phase</button>
    <div class="flex justify-end gap-2 mt-3">
      <button type="button" class="cancel-phase-edit-btn border border-slate-300 px-3 py-1.5 rounded-lg text-xs font-medium">Cancel</button>
      <button type="button" class="save-phase-edit-btn bg-slate-900 text-white px-3 py-1.5 rounded-lg text-xs font-medium">Save phases</button>
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
    alert("A journey needs at least one phase — add one before saving.");
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
      alert("Every phase needs a name, a start day, and an end day.");
      return;
    }
    if (Number(p.start) > Number(p.end)) {
      alert(`Phase "${p.name}" has a start day after its end day.`);
      return;
    }
  }

  // Non-blocking overlap warning — a newcomer's dashboard picks one phase per
  // day, so overlapping windows are usually a mistake, but not always.
  const byStart = [...parsed].sort((a, b) => Number(a.start) - Number(b.start));
  for (let i = 1; i < byStart.length; i++) {
    if (Number(byStart[i].start) <= Number(byStart[i - 1].end)) {
      const proceed = confirm(
        `"${byStart[i - 1].name}" and "${byStart[i].name}" have overlapping day ranges. ` +
        `Newcomers may not see the phase you expect on those days. Save anyway?`
      );
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
    alert(
      `Phases saved, but ${blockedDeletions.length} phase(s) couldn't be removed because they still have tasks assigned. ` +
      `Reassign or archive those tasks first, then remove the phase.`
    );
  } else {
    alert("Phases updated.");
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
    alert("Please specify a visa type.");
    return;
  }

  if (phaseRows.length === 0) {
    alert("Add at least one phase — a journey with no phases has nowhere to attach tasks.");
    return;
  }

  for (const phase of phaseRows) {
    if (!phase.name || phase.days_after_arrival_start === "" || phase.days_after_arrival_end === "") {
      alert("Every phase needs a name, a start day, and an end day.");
      return;
    }
    if (Number(phase.days_after_arrival_start) > Number(phase.days_after_arrival_end)) {
      alert(`Phase "${phase.name}" has a start day after its end day.`);
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
    alert(`A journey already exists for ${visaType.replace("_", " ")} · ${ukRegion.replace("_", " ")}. Edit or clone that one instead of creating a duplicate.`);
    return;
  }

  const { data: newJourney, error: journeyError } = await supabaseClient
    .from("journeys")
    .insert({ name, visa_type: visaType, uk_region: ukRegion })
    .select()
    .single();

  if (journeyError || !newJourney) {
    alert("Could not create journey: " + (journeyError?.message || "unknown error"));
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
    alert("Journey was created, but its phases failed to save: " + phaseError.message + "\nYou can add phases for it separately.");
  } else {
    alert("Journey created with " + phaseInserts.length + " phase(s).");
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
    dependsSelect.innerHTML = `<option value="" disabled>No other tasks yet</option>`;
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
// Managers (and later, Super Admins) can see a full history of edits.
async function recordTaskVersion(taskId, changeType, snapshot, previousStatus, newStatus) {
  const { error } = await supabaseClient.from("task_versions").insert({
    task_id: taskId,
    changed_by: currentUser.id,
    change_type: changeType,
    previous_status: previousStatus || null,
    new_status: newStatus || null,
    snapshot: snapshot
  });

  if (error) {
    // Don't block the main save flow if version logging fails — just warn.
    console.error("Could not record task version:", error);
  }
}

function resetForm() {
  document.getElementById("task-form").reset();
  document.getElementById("task_id").value = "";
  document.getElementById("form-heading").textContent = "Create a task";
  document.getElementById("submit-btn").textContent = "Save as draft";
  document.getElementById("status").value = "draft";
  document.getElementById("cancel-edit-btn").classList.add("hidden");
  document.getElementById("region_england").checked = true;
  Array.from(document.getElementById("depends_on").options).forEach(opt => opt.selected = false);
  loadDependsOnOptions(null);
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
    alert("Could not load task for editing.");
    return;
  }

  document.getElementById("task_id").value = task.id;
  document.getElementById("title").value = task.title;
  document.getElementById("body_html").value = task.body_html || "";
  document.getElementById("category").value = task.category || "Housing";
  document.getElementById("urgency").value = task.urgency;
  document.getElementById("time_estimate").value = task.time_estimate_minutes || "";
  document.getElementById("is_minor_task").checked = task.is_minor_task || false;
  document.getElementById("status").value = task.status || "draft";

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

  document.getElementById("form-heading").textContent = "Edit task";
  document.getElementById("submit-btn").textContent = "Save changes";
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
  if (!confirm("Archive this task? It will no longer show to newcomers.")) return;
  await changeTaskStatus(taskId, "archived");
}

// --- SE2L-62: draft -> in_review -> published state transitions ---
// Handles moving a task through the review workflow, and logs every
// transition into task_versions (SE2L-63) so there's a full audit trail.
async function changeTaskStatus(taskId, newStatus) {
  const { data: existingTask, error: fetchError } = await supabaseClient
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .single();

  if (fetchError || !existingTask) {
    alert("Could not load task to change its status.");
    return;
  }

  const previousStatus = existingTask.status;

  const { error: updateError } = await supabaseClient
    .from("tasks")
    .update({ status: newStatus })
    .eq("id", taskId);

  if (updateError) {
    alert("Could not update task status: " + updateError.message);
    return;
  }

  await recordTaskVersion(
    taskId,
    "status_change",
    { ...existingTask, status: newStatus },
    previousStatus,
    newStatus
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
  draft: "Draft",
  in_review: "In review",
  published: "Published",
  archived: "Archived"
};

function renderStatusActions(task) {
  const buttons = [];

  if (task.status === "draft") {
    buttons.push(`<button data-status-action="in_review" data-task-id="${task.id}" class="text-xs text-amber-700 font-medium">Submit for review</button>`);
  }
  if (task.status === "in_review") {
    buttons.push(`<button data-status-action="published" data-task-id="${task.id}" class="text-xs text-green-700 font-medium">Publish</button>`);
    buttons.push(`<button data-status-action="draft" data-task-id="${task.id}" class="text-xs text-slate-500 font-medium">Send back to draft</button>`);
  }
  if (task.status === "published") {
    buttons.push(`<button data-status-action="draft" data-task-id="${task.id}" class="text-xs text-slate-500 font-medium">Unpublish to draft</button>`);
  }

  return buttons.join("");
}

async function loadExistingTasks() {
  const { data: tasks } = await supabaseClient
    .from("tasks")
    .select("*")
    .order("created_at", { ascending: false });

  const listDiv = document.getElementById("task-list");

  if (!tasks || tasks.length === 0) {
    listDiv.innerHTML = `<p class="text-sm text-slate-400">No tasks created yet.</p>`;
    return;
  }

  listDiv.innerHTML = tasks.map(t => `
    <div class="bg-white border border-slate-200 rounded-lg p-3 flex justify-between items-center ${t.status === "archived" ? "opacity-50" : ""}">
      <div>
        <p class="text-sm font-medium">${t.title} ${t.is_minor_task ? "· <span class=\"text-indigo-600\">Minor</span>" : ""}</p>
        <p class="text-xs text-slate-500 mt-0.5">
          <span class="${statusBadgeStyles[t.status] || "bg-slate-100 text-slate-500"} px-2 py-0.5 rounded-full">${statusLabels[t.status] || t.status}</span>
          · ${t.urgency} · ${t.category || "Uncategorised"}
        </p>
      </div>
      <div class="flex gap-3 items-center flex-wrap justify-end">
        ${renderStatusActions(t)}
        <a href="preview.html?task=${t.id}" target="_blank" class="text-xs text-slate-500 font-medium">Preview</a>
        ${t.status !== "archived" ? `<button data-edit-id="${t.id}" class="text-xs text-indigo-600 font-medium">Edit</button>` : ""}
        ${t.status !== "archived" ? `<button data-archive-id="${t.id}" class="text-xs text-red-600 font-medium">Archive</button>` : ""}
      </div>
    </div>
  `).join("");

  listDiv.querySelectorAll("[data-edit-id]").forEach(btn => {
    btn.addEventListener("click", () => loadTaskForEdit(btn.dataset.editId));
  });

  listDiv.querySelectorAll("[data-archive-id]").forEach(btn => {
    btn.addEventListener("click", () => archiveTask(btn.dataset.archiveId));
  });

  listDiv.querySelectorAll("[data-status-action]").forEach(btn => {
    btn.addEventListener("click", () => changeTaskStatus(btn.dataset.taskId, btn.dataset.statusAction));
  });
}

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
    alert("Please select a phase, at least one visa type, and at least one UK region.");
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
        status
      })
      .eq("id", taskId);

    if (updateError) {
      alert("Could not update task: " + updateError.message);
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
        created_by: currentUser.id
      })
      .select()
      .single();

    if (taskError) {
      alert("Could not create task: " + taskError.message);
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

  alert(taskId ? "Task saved." : "Task created as " + statusLabels[status || "draft"] + ".");
  resetForm();
  loadExistingTasks();
}

async function init() {
  const user = await checkAppManagerAccess();
  if (!user) return;
  currentUser = user;

  await loadPhaseOptions();
  await loadDependsOnOptions(null);
  await loadExistingTasks();
  await loadExistingJourneys();

  addPhaseRow();
  addPhaseRow();

  document.getElementById("task-form").addEventListener("submit", handleFormSubmit);
  document.getElementById("cancel-edit-btn").addEventListener("click", resetForm);

  document.getElementById("journey-form").addEventListener("submit", handleJourneyFormSubmit);
  document.getElementById("add-phase-row-btn").addEventListener("click", () => addPhaseRow());
  document.getElementById("journey_visa_type").addEventListener("change", (e) => {
    document.getElementById("journey_visa_type_other").classList.toggle("hidden", e.target.value !== "other");
  });
}

init();