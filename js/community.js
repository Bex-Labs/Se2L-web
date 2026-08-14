// SE2L-92: community features (forum, peer Q&A, local groups)
//
// All three "modes" share one underlying table, community_posts,
// distinguished by post_type. This file handles: fetching/filtering
// the feed, the new-post form (including first-time display name
// setup), and flagging a post for moderator review.
//
// Posts are pseudonymous — display names live in community_profiles,
// separate from the user's real profile. author_id still points to
// the real auth user underneath, but nothing in the UI surfaces that.

let currentPostType = "forum";
let currentUserId = null;
let currentDisplayName = null;

const POST_TYPE_LABELS = {
  forum: "Forum",
  question: "Peer Q&A",
  local_group: "Local groups",
};

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;

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

// --- Loading the current user's community profile (display name) ---

async function loadCommunityProfile(userId) {
  const { data, error } = await supabaseClient
    .from("community_profiles")
    .select("display_name")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Failed to load community profile:", error);
    return null;
  }
  return data ? data.display_name : null;
}

// --- Feed rendering ---

function renderPostCard(post) {
  const typeLabel = POST_TYPE_LABELS[post.post_type] || post.post_type;
  const regionTag = post.post_type === "local_group" && post.region
    ? `<span class="badge badge-pending">${escapeHtml(post.region)}</span>`
    : "";
  const answeredTag = post.post_type === "question" && post.accepted_reply_id
    ? `<span class="badge">Answered</span>`
    : "";
  const authorName = post.community_profiles?.display_name || "A community member";

  return `
    <div class="card mb-4" data-post-id="${post.id}">
      <div class="flex items-center gap-2 mb-2">
        ${regionTag}
        ${answeredTag}
      </div>
      <h3 style="font-family: var(--font-heading); font-weight: 700; font-size: 1rem; margin-bottom: 0.35rem;">
        <a href="community-post.html?id=${post.id}" class="post-title-link" style="color: inherit; text-decoration: none;">${escapeHtml(post.title)}</a>
      </h3>
      <p class="text-sm text-slate-600 mb-3" style="white-space: pre-wrap;">${escapeHtml(post.body)}</p>
      <div class="flex items-center justify-between text-sm text-slate-500">
        <span>${escapeHtml(authorName)} · ${timeAgo(post.created_at)}</span>
        <button type="button" class="btn btn-ghost btn-sm report-post-btn" data-post-id="${post.id}">Report</button>
      </div>
    </div>
  `;
}

async function loadFeed() {
  const feedEl = document.getElementById("community-feed");
  const emptyEl = document.getElementById("community-empty-state");
  const loadingEl = document.getElementById("community-loading-state");

  loadingEl.classList.remove("hidden");
  emptyEl.classList.add("hidden");
  feedEl.innerHTML = "";

  const { data: posts, error } = await supabaseClient
    .from("community_posts")
    .select("id, post_type, title, body, region, accepted_reply_id, created_at, community_profiles(display_name)")
    .eq("post_type", currentPostType)
    .order("created_at", { ascending: false })
    .limit(50);

  loadingEl.classList.add("hidden");

  if (error) {
    console.error("Failed to load community feed:", error);
    feedEl.innerHTML = `<p class="text-sm text-slate-500 text-center" style="padding: 2rem 0;">Something went wrong loading posts — please try again.</p>`;
    return;
  }

  if (!posts || posts.length === 0) {
    emptyEl.classList.remove("hidden");
    return;
  }

  feedEl.innerHTML = posts.map(renderPostCard).join("");

  feedEl.querySelectorAll(".report-post-btn").forEach((btn) => {
    btn.addEventListener("click", () => reportPost(btn.dataset.postId));
  });

  feedEl.querySelectorAll(".post-title-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const card = link.closest(".card");
      card?.classList.add("is-pressed");
      const href = link.getAttribute("href");
      setTimeout(() => {
        window.location.href = href;
      }, 150);
    });
  });
}

// --- Tab switching ---

function initTabs() {
  document.querySelectorAll(".community-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".community-tab").forEach((t) => {
        t.classList.remove("is-active");
        t.setAttribute("aria-selected", "false");
      });
      tab.classList.add("is-active");
      tab.setAttribute("aria-selected", "true");

      currentPostType = tab.dataset.postType;
      document.getElementById("new-post-context").textContent = `Posting to: ${POST_TYPE_LABELS[currentPostType]}`;

      const regionField = document.getElementById("post-region-field");
      const regionInput = document.getElementById("post-region");
      if (currentPostType === "local_group") {
        regionField.hidden = false;
        regionInput.required = true;
      } else {
        regionField.hidden = true;
        regionInput.required = false;
      }

      loadFeed();
    });
  });
}

// --- New post form ---

function initNewPostForm() {
  const newPostBtn = document.getElementById("new-post-btn");
  const cancelBtn = document.getElementById("cancel-post-btn");
  const newPostCard = document.getElementById("new-post-card");
  const form = document.getElementById("new-post-form");
  const message = document.getElementById("new-post-message");
  const displayNameField = document.getElementById("display-name-field");

  newPostBtn.addEventListener("click", () => {
    newPostCard.classList.remove("hidden");
    displayNameField.hidden = !!currentDisplayName;
    newPostBtn.classList.add("hidden");
  });

  cancelBtn.addEventListener("click", () => {
    form.reset();
    message.classList.add("hidden");
    newPostCard.classList.add("hidden");
    newPostBtn.classList.remove("hidden");
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById("submit-post-btn");
    submitBtn.disabled = true;
    message.classList.add("hidden");

    try {
      // First-time posters need a display name before anything else happens.
      if (!currentDisplayName) {
        const chosenName = document.getElementById("post-display-name").value.trim();
        if (!chosenName) {
          throw new Error("Please choose a display name to post.");
        }
        const { error: profileError } = await supabaseClient
          .from("community_profiles")
          .insert({ user_id: currentUserId, display_name: chosenName });

        if (profileError) {
          if (profileError.code === "23505") {
            throw new Error("That display name is already taken — please choose another.");
          }
          throw profileError;
        }
        currentDisplayName = chosenName;
      }

      const title = document.getElementById("post-title").value.trim();
      const body = document.getElementById("post-body").value.trim();
      const region = document.getElementById("post-region").value.trim();

      const payload = {
        author_id: currentUserId,
        post_type: currentPostType,
        title,
        body,
      };
      if (currentPostType === "local_group") {
        payload.region = region;
      }

      const { error: postError } = await supabaseClient.from("community_posts").insert(payload);
      if (postError) throw postError;

      form.reset();
      newPostCard.classList.add("hidden");
      newPostBtn.classList.remove("hidden");
      await loadFeed();
    } catch (err) {
      message.textContent = err.message || "Something went wrong — please try again.";
      message.classList.remove("hidden");
      console.error(err);
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// --- Reporting ---

async function reportPost(postId) {
  const reason = window.prompt("What's the issue with this post? (optional)");
  if (reason === null) return; // user cancelled

  const { error } = await supabaseClient.from("community_flags").insert({
    target_type: "post",
    target_id: postId,
    reporter_id: currentUserId,
    reason: reason || null,
  });

  if (error) {
    console.error("Failed to report post:", error);
    window.alert("Something went wrong submitting your report — please try again.");
    return;
  }

  window.alert("Thanks — this post has been reported for review.");
}

// --- Init ---

(async function initCommunityPage() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  currentUserId = user.id;
  currentDisplayName = await loadCommunityProfile(user.id);

  initTabs();
  initNewPostForm();
  await loadFeed();
})();
