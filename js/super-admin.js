// SE2L-13: Super Admin panel — was previously a fully static mockup with
// zero auth check. This mirrors app-manager.js's checkAppManagerAccess
// pattern, gated on role === "super_admin" instead.

async function checkSuperAdminAccess() {
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

  if (!profile || profile.role !== "super_admin") {
    document.querySelector(".max-w-2xl").innerHTML = `
      <p class="text-sm text-red-600 mt-10">You don't have access to this page.</p>
    `;
    return null;
  }

  // Populates the sidebar identity strip — reuses the role already
  // fetched above rather than a second query. No app_manager branch
  // needed: the access check above guarantees only super_admin reaches
  // this point, so the pill is always "Super Admin" in practice.
  const emailEl = document.getElementById("sidebar-user-email");
  if (emailEl) emailEl.textContent = user.email || "Unknown user";

  return user;
}

async function loadPlatformStats() {
  const [
    appManagerResult,
    journeyResult,
    regionsResult,
    publishedResult,
    draftResult
  ] = await Promise.all([
    supabaseClient.from("users").select("*", { count: "exact", head: true }).eq("role", "app_manager"),
    supabaseClient.from("journeys").select("*", { count: "exact", head: true }),
    supabaseClient.from("journeys").select("uk_region"),
    supabaseClient.from("tasks").select("*", { count: "exact", head: true }).eq("status", "published"),
    supabaseClient.from("tasks").select("*", { count: "exact", head: true }).eq("status", "draft")
  ]);

  const anyQueryFailed = [appManagerResult, journeyResult, regionsResult, publishedResult, draftResult]
    .some(r => r.error);

  const uniqueRegionCount = new Set((regionsResult.data || []).map(r => r.uk_region)).size;

  document.getElementById("stat-app-managers").textContent = appManagerResult.count ?? "—";
  document.getElementById("stat-journeys").textContent = journeyResult.count ?? "—";
  document.getElementById("stat-regions").textContent = uniqueRegionCount;
  document.getElementById("stat-content-status").textContent =
    `${publishedResult.count ?? 0} published, ${draftResult.count ?? 0} draft`;

  // --- System checks, now reflecting real query results instead of hardcoded text ---
  setCheckStatus("check-task-content", (publishedResult.count ?? 0) > 0, "Ready", "No published tasks yet");
  setCheckStatus("check-onboarding", (journeyResult.count ?? 0) > 0, "Ready", "No journeys configured yet");
  setCheckStatus("check-backend", !anyQueryFailed, "Connected", "Query failed — check console");
  setCheckStatus("check-auth-roles", (appManagerResult.count ?? 0) > 0, "Ready", "No app_manager accounts exist yet");
}

function setCheckStatus(elementId, isReady, readyLabel, notReadyLabel) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = isReady ? readyLabel : notReadyLabel;
  // Uses the .status-pill classes from css/shell.css instead of setting
  // hex colors directly — same visual result, but now a palette change
  // only needs to happen in one CSS file instead of here too.
  el.classList.remove("is-ready", "is-not-ready");
  el.classList.add("status-pill", isReady ? "is-ready" : "is-not-ready");
}

// --- SE2L-73: manage App Manager accounts ---

async function loadAppManagerAccounts() {
  const listDiv = document.getElementById("app-manager-list");

  const { data: managers, error } = await supabaseClient
    .from("users")
    .select("id, email, is_active")
    .eq("role", "app_manager")
    .order("email", { ascending: true });

  if (error) {
    listDiv.innerHTML = `<p class="text-sm text-red-600">Could not load App Manager accounts.</p>`;
    return;
  }

  if (!managers || managers.length === 0) {
    listDiv.innerHTML = `<p class="text-sm text-slate-400">No App Manager accounts yet.</p>`;
    return;
  }

  listDiv.innerHTML = managers.map(m => `
    <div class="admin-account-card">
      <div>
        <p class="admin-account-email">${m.email}</p>
        <p class="admin-account-status ${m.is_active ? "is-active" : "is-inactive"}">${m.is_active ? "Active" : "Deactivated"}</p>
      </div>
      <button data-toggle-user-id="${m.id}" data-currently-active="${m.is_active}" class="admin-toggle-switch ${m.is_active ? "is-on" : ""}" aria-label="${m.is_active ? "Deactivate" : "Reactivate"} this App Manager">
        <span class="admin-toggle-switch-knob"></span>
      </button>
    </div>
  `).join("");

  listDiv.querySelectorAll("[data-toggle-user-id]").forEach(btn => {
    btn.addEventListener("click", () => {
      const userId = btn.dataset.toggleUserId;
      const currentlyActive = btn.dataset.currentlyActive === "true";
      toggleAppManagerActive(userId, !currentlyActive);
    });
  });
}

async function toggleAppManagerActive(targetUserId, makeActive) {
  const confirmMessage = makeActive
    ? "Reactivate this App Manager's access?"
    : "Deactivate this App Manager? They'll be signed out and unable to log back in until reactivated.";

  if (!confirm(confirmMessage)) return;

  const { data: { session } } = await supabaseClient.auth.getSession();

  const { data, error } = await supabaseClient.functions.invoke("set-app-manager-active", {
    body: { targetUserId, isActive: makeActive },
    headers: { Authorization: `Bearer ${session.access_token}` }
  });

  if (error || !data || data.error) {
    alert("Could not update account status: " + (data?.error || error?.message || "unknown error"));
    return;
  }

  await loadAppManagerAccounts();
}

async function loadPendingInvites() {
  const listDiv = document.getElementById("pending-invite-list");

  const { data: invites, error } = await supabaseClient
    .from("app_manager_invites")
    .select("id, email, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    listDiv.innerHTML = `<p class="text-sm text-red-600">Could not load pending invites.</p>`;
    return;
  }

  if (!invites || invites.length === 0) {
    listDiv.innerHTML = `<p class="text-sm text-slate-400">No pending invites.</p>`;
    return;
  }

  listDiv.innerHTML = invites.map(i => `
    <div class="admin-invite-card">
      <p class="text-sm">${i.email}</p>
      <span class="admin-invite-pill">Invite pending</span>
    </div>
  `).join("");
}

document.getElementById("invite-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = document.getElementById("invite_email").value.trim();
  if (!email) return;

  const { data: { user } } = await supabaseClient.auth.getUser();

  const { data: invite, error: insertError } = await supabaseClient
    .from("app_manager_invites")
    .insert({ email, invited_by: user.id })
    .select()
    .single();

  if (insertError || !invite) {
    alert("Could not create invite: " + (insertError?.message || "unknown error"));
    return;
  }

  const appOrigin = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, "");

  const { error: sendError } = await supabaseClient.functions.invoke("send-app-manager-invite", {
    body: { email, inviteToken: invite.invite_token, appOrigin }
  });

  if (sendError) {
    alert("Invite created, but the email failed to send. You may need to share the link manually.");
  } else {
    alert(`Invite sent to ${email}.`);
  }

  document.getElementById("invite-form").reset();
  await loadPendingInvites();
});


// --- SE2L-74: configure available visa types and UK regions ---

async function loadVisaTypesAndRegions() {
  await Promise.all([loadOptionList("available_visa_types", "visa-type-list"), loadOptionList("available_uk_regions", "uk-region-list")]);
}

async function loadOptionList(tableName, listElementId) {
  const listDiv = document.getElementById(listElementId);

  const { data: rows, error } = await supabaseClient
    .from(tableName)
    .select("id, value, label, is_active")
    .order("sort_order", { ascending: true });

  if (error) {
    listDiv.innerHTML = `<p class="text-sm text-red-600">Could not load this list.</p>`;
    return;
  }

  if (!rows || rows.length === 0) {
    listDiv.innerHTML = `<p class="text-sm text-slate-400">Nothing configured yet.</p>`;
    return;
  }

  listDiv.innerHTML = rows.map(r => `
    <div class="admin-account-card">
      <div>
        <p class="admin-account-email">${r.label}</p>
        <p class="admin-account-status ${r.is_active ? "is-active" : "is-inactive"}">${r.is_active ? "Active" : "Hidden"} · ${r.value}</p>
      </div>
      <button data-toggle-option-id="${r.id}" data-option-table="${tableName}" data-currently-active="${r.is_active}" class="admin-toggle-switch ${r.is_active ? "is-on" : ""}" aria-label="${r.is_active ? "Hide" : "Activate"} ${r.label}">
        <span class="admin-toggle-switch-knob"></span>
      </button>
    </div>
  `).join("");

  listDiv.querySelectorAll("[data-toggle-option-id]").forEach(btn => {
    btn.addEventListener("click", () => {
      const optionId = btn.dataset.toggleOptionId;
      const table = btn.dataset.optionTable;
      const currentlyActive = btn.dataset.currentlyActive === "true";
      toggleOptionActive(table, optionId, !currentlyActive, listElementId);
    });
  });
}

async function toggleOptionActive(tableName, optionId, makeActive, listElementId) {
  const { error } = await supabaseClient
    .from(tableName)
    .update({ is_active: makeActive })
    .eq("id", optionId);

  if (error) {
    alert("Could not update: " + error.message);
    return;
  }

  await loadOptionList(tableName, listElementId);
}

document.getElementById("add-visa-type-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const value = document.getElementById("new_visa_type_value").value.trim().toLowerCase().replace(/\s+/g, "_");
  const label = document.getElementById("new_visa_type_label").value.trim();
  if (!value || !label) return;

  const { error } = await supabaseClient
    .from("available_visa_types")
    .insert({ value, label });

  if (error) {
    alert("Could not add visa type: " + error.message);
    return;
  }

  document.getElementById("add-visa-type-form").reset();
  await loadOptionList("available_visa_types", "visa-type-list");
});

document.getElementById("add-uk-region-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const value = document.getElementById("new_uk_region_value").value.trim().toLowerCase().replace(/\s+/g, "_");
  const label = document.getElementById("new_uk_region_label").value.trim();
  if (!value || !label) return;

  const { error } = await supabaseClient
    .from("available_uk_regions")
    .insert({ value, label });

  if (error) {
    alert("Could not add UK region: " + error.message);
    return;
  }

  document.getElementById("add-uk-region-form").reset();
  await loadOptionList("available_uk_regions", "uk-region-list");
});

// --- SE2L-75: override or unpublish any content, regardless of author ---

let allModerationTasks = [];
let allModerationResources = [];
let currentSuperAdminUser = null;
let moderationRejectionNotes = {};

async function loadModerationTasks() {
  const [{ data, error }, { data: versionRows }] = await Promise.all([
    supabaseClient
      .from("tasks")
      .select("id, title, status, category, urgency")
      .order("title", { ascending: true }),
    supabaseClient
      .from("task_versions")
      .select("task_id, review_note, created_at")
      .not("review_note", "is", null)
      .order("created_at", { ascending: false })
  ]);

  if (error) {
    document.getElementById("moderation-task-list").innerHTML = `<p class="text-sm text-red-600">Could not load tasks.</p>`;
    return;
  }

  moderationRejectionNotes = {};
  (versionRows || []).forEach(v => {
    if (!moderationRejectionNotes[v.task_id]) {
      moderationRejectionNotes[v.task_id] = v.review_note;
    }
  });

  allModerationTasks = data || [];
  renderModerationTasks();
}

function renderModerationTasks() {
  const listDiv = document.getElementById("moderation-task-list");
  const term = document.getElementById("moderation-task-search").value.toLowerCase();
  const filtered = allModerationTasks.filter(t => t.title.toLowerCase().includes(term));

  if (filtered.length === 0) {
    listDiv.innerHTML = `<p class="text-sm text-slate-400">No matching tasks.</p>`;
    return;
  }

  listDiv.innerHTML = filtered.map(t => `
    <div class="admin-account-card">
      <div>
        <p class="admin-account-email">${t.title}</p>
        <p class="moderation-status is-${t.status}">${t.status.replace("_", " ")} · ${t.urgency} · ${t.category || "Uncategorised"}</p>
        ${t.status === "draft" && moderationRejectionNotes[t.id] ? `<p class="text-xs" style="color: var(--color-critical); margin-top: 0.25rem;">Sent back: ${moderationRejectionNotes[t.id]}</p>` : ""}
      </div>
      <div class="flex gap-2">
        ${t.status !== "draft" && t.status !== "archived" ? `<button data-task-id="${t.id}" data-new-status="draft" data-reject="true" class="moderation-action-btn moderation-task-btn">Unpublish</button>` : ""}
        ${t.status !== "archived" ? `<button data-task-id="${t.id}" data-new-status="archived" class="moderation-action-btn is-danger moderation-task-btn">Archive</button>` : ""}
      </div>
    </div>
  `).join("");

  listDiv.querySelectorAll(".moderation-task-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.dataset.reject === "true") {
        // SE2L-95 follow-up: same required-reason rule as app-manager.js's
        // review flow — unpublishing from here shouldn't be a silent,
        // unexplained action either.
        const reason = prompt("Why is this being unpublished? This will be shown to the person who submitted it.");
        if (reason === null) return; // cancelled
        if (!reason.trim()) {
          alert("Please give a reason so the App Manager knows what happened.");
          return;
        }
        updateModerationTaskStatus(btn.dataset.taskId, btn.dataset.newStatus, reason.trim());
        return;
      }
      updateModerationTaskStatus(btn.dataset.taskId, btn.dataset.newStatus);
    });
  });
}

async function updateModerationTaskStatus(taskId, newStatus, reviewNote) {
  if (!confirm(`Change this task's status to "${newStatus}"? This overrides it regardless of who created it.`)) return;

  // Fetch first so the audit trail has a real "before" snapshot, same
  // pattern as changeTaskStatus in app-manager.js — moderation actions
  // were previously invisible to task_versions entirely, which broke
  // the "full history of edits" promise for anything changed here.
  const { data: existingTask, error: fetchError } = await supabaseClient
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .single();

  if (fetchError || !existingTask) {
    alert("Could not load task.");
    return;
  }

  const previousStatus = existingTask.status;

  const { error } = await supabaseClient
    .from("tasks")
    .update({ status: newStatus })
    .eq("id", taskId);

  if (error) {
    alert("Could not update task: " + error.message);
    return;
  }

  if (currentSuperAdminUser) {
    const { error: versionError } = await supabaseClient.from("task_versions").insert({
      task_id: taskId,
      changed_by: currentSuperAdminUser.id,
      change_type: "status_change",
      previous_status: previousStatus,
      new_status: newStatus,
      snapshot: { ...existingTask, status: newStatus },
      review_note: reviewNote || null
    });

    if (versionError) {
      console.error("Could not record task version:", versionError);
    }
  }

  await loadModerationTasks();
}

document.getElementById("moderation-task-search").addEventListener("input", renderModerationTasks);

async function loadModerationResources() {
  const { data, error } = await supabaseClient
    .from("resources")
    .select("id, title, status, category")
    .order("title", { ascending: true });

  if (error) {
    document.getElementById("moderation-resource-list").innerHTML = `<p class="text-sm text-red-600">Could not load resources.</p>`;
    return;
  }

  allModerationResources = data || [];
  renderModerationResources();
}

function renderModerationResources() {
  const listDiv = document.getElementById("moderation-resource-list");
  const term = document.getElementById("moderation-resource-search").value.toLowerCase();
  const filtered = allModerationResources.filter(r => r.title.toLowerCase().includes(term));

  if (filtered.length === 0) {
    listDiv.innerHTML = `<p class="text-sm text-slate-400">No matching resources.</p>`;
    return;
  }

  listDiv.innerHTML = filtered.map(r => `
    <div class="admin-account-card">
      <div>
        <p class="admin-account-email">${r.title}</p>
        <p class="moderation-status is-${r.status}">${r.status} · ${r.category || "Uncategorised"}</p>
      </div>
      ${r.status === "published" ? `<button data-resource-id="${r.id}" class="moderation-action-btn moderation-resource-btn">Unpublish</button>` : ""}
    </div>
  `).join("");

  listDiv.querySelectorAll(".moderation-resource-btn").forEach(btn => {
    btn.addEventListener("click", () => updateModerationResourceStatus(btn.dataset.resourceId));
  });
}

async function updateModerationResourceStatus(resourceId) {
  if (!confirm("Unpublish this resource? This overrides it regardless of who created it.")) return;

  const { error } = await supabaseClient
    .from("resources")
    .update({ status: "draft" })
    .eq("id", resourceId);

  if (error) {
    alert("Could not update resource: " + error.message);
    return;
  }

  await loadModerationResources();
}

document.getElementById("moderation-resource-search").addEventListener("input", renderModerationResources);

// Sidebar section-switching — same pattern as app-manager.html. Shows one
// of Overview/App Managers/Visa & Regions/Moderation at a time; all data
// still loads on page load exactly as before, this only toggles display.
function setupPanelSwitching() {
  const subnavLinks = document.querySelectorAll("#app-sidebar [data-panel-target]");

  subnavLinks.forEach(link => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const targetId = link.dataset.panelTarget;

      document.querySelectorAll(".admin-panel").forEach(panel => {
        panel.classList.toggle("is-active-panel", panel.id === targetId);
      });

      subnavLinks.forEach(l => l.classList.toggle("is-active-subnav", l === link));

      // Clear any nested Email Templates/Branding/Terms highlighting when
      // navigating away from Platform Settings — otherwise whichever one
      // was last active stays stuck highlighted on an unrelated panel.
      if (targetId !== "panel-settings") {
        document.querySelectorAll(".sidebar-subnav [data-subpanel-target]").forEach(l => {
          l.classList.remove("is-active-subnav");
        });
      } else {
        // Re-entering Platform Settings — re-highlight whichever nested
        // link matches the sub-panel that's actually showing.
        const activeSubpanel = document.querySelector(".settings-subpanel.is-active-subpanel");
        if (activeSubpanel) {
          document.querySelectorAll(".sidebar-subnav [data-subpanel-target]").forEach(l => {
            l.classList.toggle("is-active-subnav", l.dataset.subpanelTarget === activeSubpanel.id);
          });
        }
      }
    });
  });
}

// Nested switching within Platform Settings — same idea one level deeper,
// separate data attribute (data-subpanel-target) so it doesn't collide
// with the top-level panel switching above. Also activates the parent
// "Platform Settings" panel itself, since clicking a nested link should
// work regardless of which top-level panel is currently showing.
function setupSettingsSubpanelSwitching() {
  const subpanelLinks = document.querySelectorAll(".sidebar-subnav [data-subpanel-target]");
  const topLevelLinks = document.querySelectorAll("#app-sidebar [data-panel-target]");

  subpanelLinks.forEach(link => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const targetId = link.dataset.subpanelTarget;

      document.querySelectorAll(".settings-subpanel").forEach(panel => {
        panel.classList.toggle("is-active-subpanel", panel.id === targetId);
      });

      subpanelLinks.forEach(l => l.classList.toggle("is-active-subnav", l === link));

      // Activate the parent Platform Settings panel, whichever top-level
      // panel was showing before this click.
      document.querySelectorAll(".admin-panel").forEach(panel => {
        panel.classList.toggle("is-active-panel", panel.id === "panel-settings");
      });
      topLevelLinks.forEach(l => l.classList.toggle("is-active-subnav", l.dataset.panelTarget === "panel-settings"));
    });
  });
}

// --- SE2L-77: manage platform settings (Terms of Service) ---

async function loadTermsOfService() {
  const { data: page, error } = await supabaseClient
    .from("legal_pages")
    .select("*")
    .eq("slug", "terms")
    .maybeSingle();

  if (error || !page) {
    document.getElementById("terms_title").value = "Terms of Service";
    document.getElementById("terms_body").value = "";
    return;
  }

  document.getElementById("terms_title").value = page.title;
  document.getElementById("terms_body").value = page.body_html;
}

document.getElementById("save-terms-btn").addEventListener("click", async () => {
  const title = document.getElementById("terms_title").value.trim();
  const bodyHtml = document.getElementById("terms_body").value;
  const messageEl = document.getElementById("terms-save-message");

  const { error } = await supabaseClient
    .from("legal_pages")
    .update({
      title: title || "Terms of Service",
      body_html: bodyHtml,
      updated_at: new Date().toISOString()
    })
    .eq("slug", "terms");

  messageEl.classList.remove("hidden", "text-red-600", "text-green-600");

  if (error) {
    messageEl.textContent = "Could not save: " + error.message;
    messageEl.classList.add("text-red-600");
    return;
  }

  messageEl.textContent = "Saved successfully.";
  messageEl.classList.add("text-green-600");
});

// --- SE2L-77: manage platform settings (Branding) ---

async function loadBrandingSettings() {
  const { data: settings, error } = await supabaseClient
    .from("platform_settings")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error || !settings) return;

  document.getElementById("branding_site_name").value = settings.site_name || "";
  document.getElementById("branding_support_email").value = settings.support_email || "";
  document.getElementById("branding_accent_color").value = settings.accent_color || "#0d4d4d";
  document.getElementById("branding_accent_color_text").value = settings.accent_color || "#0d4d4d";
}

// Keep the color picker and its text field in sync, whichever one changes
document.getElementById("branding_accent_color").addEventListener("input", (e) => {
  document.getElementById("branding_accent_color_text").value = e.target.value;
});
document.getElementById("branding_accent_color_text").addEventListener("input", (e) => {
  if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) {
    document.getElementById("branding_accent_color").value = e.target.value;
  }
});

document.getElementById("save-branding-btn").addEventListener("click", async () => {
  const siteName = document.getElementById("branding_site_name").value.trim();
  const supportEmail = document.getElementById("branding_support_email").value.trim();
  const accentColor = document.getElementById("branding_accent_color_text").value.trim();
  const messageEl = document.getElementById("branding-save-message");

  const { data: existing } = await supabaseClient
    .from("platform_settings")
    .select("id")
    .limit(1)
    .maybeSingle();

  const { error } = await supabaseClient
    .from("platform_settings")
    .update({
      site_name: siteName || "Se2L",
      support_email: supportEmail,
      accent_color: accentColor || "#0d4d4d",
      updated_at: new Date().toISOString()
    })
    .eq("id", existing.id);

  messageEl.classList.remove("hidden", "text-red-600", "text-green-600");

  if (error) {
    messageEl.textContent = "Could not save: " + error.message;
    messageEl.classList.add("text-red-600");
    return;
  }

  messageEl.textContent = "Saved. Changes are already live across the site.";
  messageEl.classList.add("text-green-600");
});

// --- SE2L-77: manage platform settings (Email templates) ---

const EMAIL_TEMPLATE_PLACEHOLDERS = {
  app_manager_invite: "Available: {{invite_link}}",
  dependant_invite: "Available: {{dependant_name}}, {{inviter_name}}, {{invite_link}}",
  phase_activation: "Available: {{phase_name}}",
  phase_end_warning: "Available: {{phase_name}}",
  weekly_digest: "No placeholders for this one.",
  milestone: "No placeholders for this one."
};

async function loadSelectedEmailTemplate() {
  const templateKey = document.getElementById("email_template_select").value;
  const placeholdersEl = document.getElementById("email-template-placeholders");
  placeholdersEl.textContent = EMAIL_TEMPLATE_PLACEHOLDERS[templateKey] || "";

  const { data: template, error } = await supabaseClient
    .from("email_templates")
    .select("subject, body_html")
    .eq("template_key", templateKey)
    .maybeSingle();

  document.getElementById("email-template-save-message").classList.add("hidden");

  if (error || !template) {
    document.getElementById("email_template_subject").value = "";
    document.getElementById("email_template_body").value = "";
    return;
  }

  document.getElementById("email_template_subject").value = template.subject;
  document.getElementById("email_template_body").value = template.body_html;
}

document.getElementById("email_template_select").addEventListener("change", loadSelectedEmailTemplate);

document.getElementById("save-email-template-btn").addEventListener("click", async () => {
  const templateKey = document.getElementById("email_template_select").value;
  const subject = document.getElementById("email_template_subject").value.trim();
  const bodyHtml = document.getElementById("email_template_body").value;
  const messageEl = document.getElementById("email-template-save-message");

  const { error } = await supabaseClient
    .from("email_templates")
    .update({
      subject,
      body_html: bodyHtml,
      updated_at: new Date().toISOString()
    })
    .eq("template_key", templateKey);

  messageEl.classList.remove("hidden", "text-red-600", "text-green-600");

  if (error) {
    messageEl.textContent = "Could not save: " + error.message;
    messageEl.classList.add("text-red-600");
    return;
  }

  messageEl.textContent = "Saved. New emails of this type will use this content immediately.";
  messageEl.classList.add("text-green-600");
});

async function init() {
  const user = await checkSuperAdminAccess();
  if (!user) return;

  currentSuperAdminUser = user;

  setupPanelSwitching();
  setupSettingsSubpanelSwitching();

  await loadPlatformStats();
  await loadAppManagerAccounts();
  await loadPendingInvites();
  await loadVisaTypesAndRegions();
  await loadModerationTasks();
  await loadModerationResources();
  await loadTermsOfService();
  await loadBrandingSettings();
  await loadSelectedEmailTemplate();

  setupRealtimeTaskSync();
}

// --- SE2L-95 follow-up: same real-time sync as app-manager.js, so
// Moderation and the review-count badge reflect changes made from the
// other window without needing a manual refresh.
let realtimeSyncTimeout = null;
function scheduleModerationRefresh() {
  clearTimeout(realtimeSyncTimeout);
  realtimeSyncTimeout = setTimeout(() => {
    loadModerationTasks();
    loadPlatformStats();
    refreshReviewCountBadge();
  }, 400);
}

async function refreshReviewCountBadge() {
  const badge = document.getElementById("sidebar-review-count-badge");
  if (!badge) return;

  const { count, error } = await supabaseClient
    .from("tasks")
    .select("*", { count: "exact", head: true })
    .eq("status", "in_review");

  if (error) return;

  if (count > 0) {
    badge.textContent = count;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

function setupRealtimeTaskSync() {
  supabaseClient
    .channel("super-admin-task-sync")
    .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, scheduleModerationRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "task_versions" }, scheduleModerationRefresh)
    .subscribe();
}

init();