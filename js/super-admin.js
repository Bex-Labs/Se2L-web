// SE2L-13: Super Admin panel — was previously a fully static mockup with
// zero auth check. This mirrors app-manager.js's checkAppManagerAccess
// pattern, gated on role === "super_admin" instead.

async function checkSuperAdminAccess() {
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

  if (!profile || profile.role !== "super_admin") {
    document.querySelector(".max-w-2xl").innerHTML = `
      <p class="text-sm text-red-600 mt-10">You don't have access to this page.</p>
    `;
    return null;
  }

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
  // Inline styles, not Tailwind classes — output.css is a compiled build
  // that may not contain these exact bg/text combinations (same root
  // cause as the earlier sidebar shell issue), so this guarantees the
  // color shows up regardless of what was last compiled.
  el.style.backgroundColor = isReady ? "#f0fdf4" : "#fffbeb";
  el.style.color = isReady ? "#15803d" : "#b45309";
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
    <div class="bg-slate-50 border border-slate-200 rounded-lg p-3 flex justify-between items-center">
      <div>
        <p class="text-sm font-medium">${m.email}</p>
        <p class="text-xs mt-0.5 ${m.is_active ? "text-green-700" : "text-red-600"}">${m.is_active ? "Active" : "Deactivated"}</p>
      </div>
      <button data-toggle-user-id="${m.id}" data-currently-active="${m.is_active}" class="text-xs font-medium ${m.is_active ? "text-red-600" : "text-green-700"}">
        ${m.is_active ? "Deactivate" : "Reactivate"}
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
    <div class="bg-slate-50 border border-slate-200 rounded-lg p-3 flex justify-between items-center">
      <p class="text-sm">${i.email}</p>
      <span class="text-xs text-amber-600">Invite pending</span>
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


async function init() {
  const user = await checkSuperAdminAccess();
  if (!user) return;

  await loadPlatformStats();
  await loadAppManagerAccounts();
  await loadPendingInvites();
}

init();