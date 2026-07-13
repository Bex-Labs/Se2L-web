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

  document.getElementById("task-form").addEventListener("submit", handleFormSubmit);
  document.getElementById("cancel-edit-btn").addEventListener("click", resetForm);
}

init();