// SE2L-92: community post detail + reply thread.
//
// Reads the post id from the URL (?id=...), loads the post plus its
// replies, and handles posting new replies (with the same first-time
// display-name flow as community.js). If the post is a 'question' and
// the current user is the author, each reply shows a "Mark as answer"
// button that sets community_posts.accepted_reply_id.

const POST_TYPE_LABELS = {
  forum: "Forum",
  question: "Peer Q&A",
  local_group: "Local groups",
};

let currentUserId = null;
let currentDisplayName = null;
let currentPost = null;

function getPostIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

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

// --- Loading the post + replies ---

async function loadPost(postId) {
  const { data: post, error } = await supabaseClient
    .from("community_posts")
    .select("id, post_type, title, body, region, accepted_reply_id, author_id, created_at, community_profiles(display_name)")
    .eq("id", postId)
    .maybeSingle();

  if (error || !post) {
    console.error("Failed to load post:", error);
    return null;
  }
  return post;
}

async function loadReplies(postId) {
  const { data: replies, error } = await supabaseClient
    .from("community_replies")
    .select("id, body, author_id, created_at, community_profiles(display_name)")
    .eq("post_id", postId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Failed to load replies:", error);
    return [];
  }
  return replies || [];
}

function renderPostDetail(post) {
  const tagsEl = document.getElementById("post-detail-tags");
  tagsEl.innerHTML = "";
  if (post.post_type === "local_group" && post.region) {
    tagsEl.innerHTML += `<span class="badge badge-pending">${escapeHtml(post.region)}</span>`;
  }
  if (post.post_type === "question" && post.accepted_reply_id) {
    tagsEl.innerHTML += `<span class="badge">Answered</span>`;
  }
  tagsEl.innerHTML += `<span class="badge badge-pending">${POST_TYPE_LABELS[post.post_type] || post.post_type}</span>`;

  document.getElementById("post-detail-title").textContent = post.title;
  document.getElementById("post-detail-body").textContent = post.body;

  const authorName = post.community_profiles?.display_name || "A community member";
  document.getElementById("post-detail-meta").textContent = `${authorName} · ${timeAgo(post.created_at)}`;
}

function renderReplies(replies, post) {
  const listEl = document.getElementById("replies-list");
  const emptyEl = document.getElementById("replies-empty-state");

  if (replies.length === 0) {
    listEl.innerHTML = "";
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  const isPostAuthor = currentUserId === post.author_id;
  const isQuestion = post.post_type === "question";

  listEl.innerHTML = replies.map((reply) => {
    const authorName = reply.community_profiles?.display_name || "A community member";
    const isAccepted = post.accepted_reply_id === reply.id;
    const acceptedTag = isAccepted ? `<span class="badge">Accepted answer</span>` : "";
    const canAccept = isQuestion && isPostAuthor && !isAccepted;
    const acceptBtn = canAccept
      ? `<button type="button" class="btn btn-ghost btn-sm mark-answer-btn" data-reply-id="${reply.id}">Mark as answer</button>`
      : "";
    const isReplyAuthor = currentUserId === reply.author_id;
    const deleteReplyBtn = isReplyAuthor
      ? `<button type="button" class="btn btn-ghost btn-sm delete-reply-btn" data-reply-id="${reply.id}" data-is-accepted="${isAccepted}">Delete</button>`
      : "";

    return `
      <div class="card mb-3" style="${isAccepted ? "border-top-color: var(--color-accent);" : ""}">
        <div class="mb-2">${acceptedTag}</div>
        <p class="text-sm text-slate-600 mb-3" style="white-space: pre-wrap;">${escapeHtml(reply.body)}</p>
        <div class="flex items-center justify-between text-sm text-slate-500">
          <span>${escapeHtml(authorName)} · ${timeAgo(reply.created_at)}</span>
          <div class="flex items-center gap-2">
            ${acceptBtn}
            ${deleteReplyBtn}
            <button type="button" class="btn btn-ghost btn-sm report-reply-btn" data-reply-id="${reply.id}">Report</button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  listEl.querySelectorAll(".mark-answer-btn").forEach((btn) => {
    btn.addEventListener("click", () => markAsAnswer(btn.dataset.replyId));
  });
  listEl.querySelectorAll(".report-reply-btn").forEach((btn) => {
    btn.addEventListener("click", () => reportItem("reply", btn.dataset.replyId));
  });
  listEl.querySelectorAll(".delete-reply-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteReply(btn.dataset.replyId, btn.dataset.isAccepted === "true"));
  });
}

async function deleteReply(replyId, isAccepted) {
  const message = isAccepted
    ? "This is the accepted answer — deleting it will remove it for everyone who finds this question, including the asker. This can't be undone. Continue?"
    : "Delete this reply? This can't be undone.";

  if (!window.confirm(message)) return;

  const { error } = await supabaseClient.from("community_replies").delete().eq("id", replyId);

  if (error) {
    console.error("Failed to delete reply:", error);
    window.alert("Something went wrong — please try again.");
    return;
  }
  await refreshPage(currentPost.id);
}

async function deletePost(postId) {
  const confirmed = window.confirm("Delete this post and all its replies? This can't be undone.");
  if (!confirmed) return;

  const { error } = await supabaseClient.from("community_posts").delete().eq("id", postId);

  if (error) {
    console.error("Failed to delete post:", error);
    window.alert("Something went wrong — please try again.");
    return;
  }
  window.location.href = "community.html";
}

async function refreshPage(postId) {
  const [post, replies] = await Promise.all([loadPost(postId), loadReplies(postId)]);
  if (!post) return null;
  currentPost = post;
  renderPostDetail(post);
  renderReplies(replies, post);
  return post;
}

// --- Marking an accepted answer ---

async function markAsAnswer(replyId) {
  const { error } = await supabaseClient
    .from("community_posts")
    .update({ accepted_reply_id: replyId })
    .eq("id", currentPost.id);

  if (error) {
    console.error("Failed to mark answer:", error);
    window.alert("Something went wrong — please try again.");
    return;
  }
  await refreshPage(currentPost.id);
}

// --- Reporting ---

async function reportItem(targetType, targetId) {
  const reason = window.prompt("What's the issue with this? (optional)");
  if (reason === null) return;

  const { error } = await supabaseClient.from("community_flags").insert({
    target_type: targetType,
    target_id: targetId,
    reporter_id: currentUserId,
    reason: reason || null,
  });

  if (error) {
    console.error("Failed to report:", error);
    window.alert("Something went wrong submitting your report — please try again.");
    return;
  }
  window.alert("Thanks — this has been reported for review.");
}

// --- Reply form ---

function initReplyForm(postId) {
  const form = document.getElementById("reply-form");
  const message = document.getElementById("reply-message");
  const displayNameField = document.getElementById("reply-display-name-field");

  displayNameField.hidden = !!currentDisplayName;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById("submit-reply-btn");
    submitBtn.disabled = true;
    message.classList.add("hidden");

    try {
      if (!currentDisplayName) {
        const chosenName = document.getElementById("reply-display-name").value.trim();
        if (!chosenName) {
          throw new Error("Please choose a display name to reply.");
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
        displayNameField.hidden = true;
      }

      const body = document.getElementById("reply-body").value.trim();
      const { error: replyError } = await supabaseClient.from("community_replies").insert({
        post_id: postId,
        author_id: currentUserId,
        body,
      });
      if (replyError) throw replyError;

      form.reset();
      await refreshPage(postId);
    } catch (err) {
      message.textContent = err.message || "Something went wrong — please try again.";
      message.classList.remove("hidden");
      console.error(err);
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// --- Init ---

(async function initPostDetailPage() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;
  currentUserId = user.id;
  currentDisplayName = await loadCommunityProfile(user.id);

  const postId = getPostIdFromUrl();
  const loadingEl = document.getElementById("post-loading-state");
  const errorEl = document.getElementById("post-error-state");
  const detailEl = document.getElementById("post-detail");

  if (!postId) {
    loadingEl.classList.add("hidden");
    errorEl.classList.remove("hidden");
    return;
  }

  const post = await refreshPage(postId);
  loadingEl.classList.add("hidden");

  if (!post) {
    errorEl.classList.remove("hidden");
    return;
  }

  detailEl.classList.remove("hidden");

  document.getElementById("report-post-detail-btn").addEventListener("click", () => reportItem("post", post.id));

  if (currentUserId === post.author_id) {
    const deleteBtn = document.getElementById("delete-post-detail-btn");
    deleteBtn.classList.remove("hidden");
    deleteBtn.addEventListener("click", () => deletePost(post.id));
  }

  initReplyForm(postId);
})();