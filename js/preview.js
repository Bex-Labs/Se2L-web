// SE2L-60: Preview task rendering for a specific user profile.
// Lets an App Manager pick a visa type + UK region and see the full
// phase-by-phase journey exactly as that profile would experience it,
// with an option to include draft/in-review content for QA before publishing.

async function checkAccess() {
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
    document.querySelector(".max-w-2xl").innerHTML = `<p class="text-sm text-red-600 mt-10">You don't have access to this page.</p>`;
    return null;
  }

  // Populates the sidebar identity strip — reuses the role already
  // fetched above rather than a second query. No super_admin branch
  // here: the access check above already guarantees only app_manager
  // reaches this point, so the pill is always "App Manager" in practice.
  const emailEl = document.getElementById("sidebar-user-email");
  if (emailEl) emailEl.textContent = user.email || "Unknown user";

  return user;
}

const statusBadge = {
  draft: `<span class="bg-slate-100 text-slate-500 text-xs px-2 py-0.5 rounded-full ml-2">Draft</span>`,
  in_review: `<span class="bg-amber-50 text-amber-700 text-xs px-2 py-0.5 rounded-full ml-2">In review</span>`,
  published: ""  // no badge needed for the normal live state
};

async function loadPreview() {
  const visaType = document.getElementById("preview_visa_type").value;
  const ukRegion = document.getElementById("preview_uk_region").value;
  const includeUnpublished = document.getElementById("include_unpublished").checked;
  const resultsDiv = document.getElementById("preview-results");

  resultsDiv.innerHTML = `<p class="text-sm text-slate-400">Loading...</p>`;

  const { data: journey, error: journeyError } = await supabaseClient
    .from("journeys")
    .select("id")
    .eq("visa_type", visaType)
    .eq("uk_region", ukRegion)
    .single();

  if (journeyError || !journey) {
    resultsDiv.innerHTML = `<p class="text-sm text-red-600">No journey exists yet for this visa type + region combination.</p>`;
    return;
  }

  const { data: phases, error: phasesError } = await supabaseClient
    .from("phases")
    .select("*")
    .eq("journey_id", journey.id)
    .order("sort_order", { ascending: true });

  if (phasesError || !phases || phases.length === 0) {
    resultsDiv.innerHTML = `<p class="text-sm text-slate-500">No phases configured for this journey yet.</p>`;
    return;
  }

  const statusFilter = includeUnpublished
    ? ["draft", "in_review", "published"]
    : ["published"];

  let html = "";

  for (const phase of phases) {
    const { data: tasks } = await supabaseClient
      .from("tasks")
      .select("*, task_phases!inner(phase_id), task_visa_types!inner(visa_type), task_uk_regions!inner(uk_region)")
      .eq("task_phases.phase_id", phase.id)
      .eq("task_visa_types.visa_type", visaType)
      .eq("task_uk_regions.uk_region", ukRegion)
      .in("status", statusFilter)
      .order("urgency", { ascending: true });

    html += `
      <div class="mb-6">
        <h2 class="text-base font-semibold mb-2">${phase.name}</h2>
        ${
          !tasks || tasks.length === 0
            ? `<p class="text-sm text-slate-400 mb-2">No matching tasks in this phase.</p>`
            : tasks.map(t => `
              <a href="task-detail.html?id=${t.id}&preview=1" target="_blank" class="bg-white border border-slate-200 rounded-xl p-4 flex justify-between items-center mb-2">
                <div>
                  <span class="text-xs text-slate-500 font-medium">${t.urgency}</span>
                  <p class="text-sm font-medium mt-0.5">${t.title}${statusBadge[t.status] || ""}</p>
                </div>
                <span>›</span>
              </a>
            `).join("")
        }
      </div>
    `;
  }

  resultsDiv.innerHTML = html;
}

async function init() {
  const user = await checkAccess();
  if (!user) return;

  // If opened from a specific task's "Preview" link (task=<id> in the URL),
  // pre-load that task's visa type/region so the preview lines up with it.
  const params = new URLSearchParams(window.location.search);
  const taskId = params.get("task");

  if (taskId) {
    const { data: task } = await supabaseClient
      .from("tasks")
      .select("*, task_visa_types(visa_type), task_uk_regions(uk_region)")
      .eq("id", taskId)
      .single();

    if (task) {
      const firstVisa = task.task_visa_types?.[0]?.visa_type;
      const firstRegion = task.task_uk_regions?.[0]?.uk_region;
      if (firstVisa) document.getElementById("preview_visa_type").value = firstVisa;
      if (firstRegion) document.getElementById("preview_uk_region").value = firstRegion;
    }
  }

  document.getElementById("load-preview-btn").addEventListener("click", loadPreview);
  loadPreview();
}

init();