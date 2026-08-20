// SE2L-92: App Manager moderation dashboard.
//
// Lists community_flags filtered by status, showing the actual
// reported post/reply content inline so a moderator doesn't have to
// jump elsewhere to see what was flagged. Two actions per flag:
// "Dismiss" (mark the flag reviewed, content stays up) or "Remove
// content" (deletes the post/reply itself and marks the flag reviewed).
//
// Relies on the App-manager-only RLS policies added alongside this
// feature: without those, this page would just show empty results for
// a non-app-manager user, never an error — RLS fails closed.

let currentStatus = "pending";

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function timeAgo(isoString) {
  const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(isoString).toLocaleDateString();
}

// --- Fetching the flagged content itself ---
// community_flags.target_id isn't a real foreign key (it can point to
// either table depending on target_type), so we fetch the target
// content in a second pass rather than relying on an embedded join.

async function fetchTargetContent(flag) {
  if (flag.target_type === "post") {
    const { data } = await supabaseClient
      .from("community_posts")
      .select("id, title, body, post_type")
      .eq("id", flag.target_id)
      .maybeSingle();
    return data;
  } else {
    const { data } = await supabaseClient
      .from("community_replies")
      .select("id, body, post_id")
      .eq("id", flag.target_id)
      .maybeSingle();
    return data;
  }
}

function renderFlagCard(flag, target) {
  const removed = !target;
  const title = flag.target_type === "post"
    ? (target ? target.title : "This post has already been removed")
    : "Reply";
  const body = target ? target.body : "";
  const actionsDisabled = removed || currentStatus !== "pending";

  return `
    <div class="card mb-4" data-flag-id="${flag.id}">
      <div class="flex items-center gap-2 mb-2">
        <span class="badge badge-pending">${flag.target_type}</span>
        <span class="text-sm text-slate-500">Reported ${timeAgo(flag.created_at)}</span>
      </div>
      <h3 style="font-family: var(--font-heading); font-weight: 700; font-size: 1rem; margin-bottom: 0.35rem;">${escapeHtml(title)}</h3>
      ${body ? `<p class="text-sm text-slate-600 mb-3" style="white-space: pre-wrap;">${escapeHtml(body)}</p>` : ""}
      ${flag.reason ? `<p class="text-sm mb-3" style="color: var(--color-text-secondary);"><strong>Reported reason:</strong> ${escapeHtml(flag.reason)}</p>` : `<p class="text-sm text-slate-400 mb-3">No reason given.</p>`}

      ${currentStatus === "pending" ? `
        <div class="flex justify-end gap-2 pt-3" style="border-top: 1px solid var(--color-border);">
          <button type="button" class="btn btn-ghost btn-sm dismiss-flag-btn" data-flag-id="${flag.id}" ${actionsDisabled && removed ? "" : ""}>Dismiss report</button>
          <button type="button" class="btn btn-secondary btn-sm remove-content-btn" data-flag-id="${flag.id}" data-target-type="${flag.target_type}" data-target-id="${flag.target_id}" ${removed ? "disabled" : ""}>Remove content</button>
        </div>
      ` : `<p class="text-sm text-slate-400">Status: ${flag.status}</p>`}
    </div>
  `;
}

async function loadQueue() {
  const loadingEl = document.getElementById("mod-loading-state");
  const emptyEl = document.getElementById("mod-empty-state");
  const queueEl = document.getElementById("mod-queue");

  loadingEl.classList.remove("hidden");
  emptyEl.classList.add("hidden");
  queueEl.innerHTML = "";

  const { data: flags, error } = await supabaseClient
    .from("community_flags")
    .select("id, target_type, target_id, reason, status, created_at")
    .eq("status", currentStatus)
    .order("created_at", { ascending: false })
    .limit(100);

  loadingEl.classList.add("hidden");

  if (error) {
    console.error("Failed to load moderation queue:", error);
    queueEl.innerHTML = `<p class="text-sm text-slate-500 text-center" style="padding: 2rem 0;">Something went wrong loading reports — please try again.</p>`;
    return;
  }

  if (!flags || flags.length === 0) {
    emptyEl.classList.remove("hidden");
    return;
  }

  const targets = await Promise.all(flags.map(fetchTargetContent));
  queueEl.innerHTML = flags.map((flag, i) => renderFlagCard(flag, targets[i])).join("");

  queueEl.querySelectorAll(".dismiss-flag-btn").forEach((btn) => {
    btn.addEventListener("click", () => dismissFlag(btn.dataset.flagId));
  });
  queueEl.querySelectorAll(".remove-content-btn").forEach((btn) => {
    btn.addEventListener("click", () => removeContent(btn.dataset.flagId, btn.dataset.targetType, btn.dataset.targetId));
  });
}

async function dismissFlag(flagId) {
  const { error } = await supabaseClient
    .from("community_flags")
    .update({ status: "dismissed" })
    .eq("id", flagId);

  if (error) {
    console.error("Failed to dismiss flag:", error);
    se2lToast("Something went wrong — please try again.", "error");
    return;
  }
  await loadQueue();
}

async function removeContent(flagId, targetType, targetId) {
  const confirmed = await se2lConfirm(
    `This will permanently delete this ${targetType}. This can't be undone. Continue?`,
    { confirmLabel: "Delete", danger: true }
  );
  if (!confirmed) return;

  const table = targetType === "post" ? "community_posts" : "community_replies";
  const { error: deleteError } = await supabaseClient.from(table).delete().eq("id", targetId);

  if (deleteError) {
    console.error("Failed to delete content:", deleteError);
    se2lToast("Something went wrong deleting this content — please try again.", "error");
    return;
  }

  const { error: flagError } = await supabaseClient
    .from("community_flags")
    .update({ status: "reviewed" })
    .eq("id", flagId);

  if (flagError) {
    console.error("Failed to update flag status:", flagError);
  }

  await loadQueue();
}

function initTabs() {
  document.querySelectorAll(".community-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".community-tab").forEach((t) => t.classList.remove("is-active"));
      tab.classList.add("is-active");
      currentStatus = tab.dataset.status;
      loadQueue();
    });
  });
}

(async function initModerationPage() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  initTabs();
  await loadQueue();
})();