function renderVideoConsentGate(container, videoId) {
  const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

  container.innerHTML = `
    <div style="position:relative; width:100%; border-radius:var(--radius-card); overflow:hidden; background:var(--color-video-bg); padding-top:56.25%;">
      <img
        src="${thumbnailUrl}"
        alt="Video preview"
        style="position:absolute; top:0; left:0; width:100%; height:100%; object-fit:cover; opacity:0.6;"
      />
      <div style="position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:0.75rem; padding:0 1.5rem; text-align:center;">
        <div style="width:3.5rem; height:3.5rem; border-radius:9999px; background:rgba(255,255,255,0.9); display:flex; align-items:center; justify-content:center;">
          <span style="color:var(--color-video-bg); font-size:1.25rem; margin-left:0.25rem;">▶</span>
        </div>
        <p style="color:#fff; font-size:0.875rem; font-weight:500; margin:0;">This task includes a YouTube video</p>
        <p style="color:rgba(255,255,255,0.8); font-size:0.75rem; max-width:20rem; margin:0;">
          Playing it will load content from YouTube, which uses cookies and may collect data per Google's privacy policy.
        </p>
        <button
          id="video-consent-btn"
          style="background:#fff; color:var(--color-video-bg); font-size:0.875rem; font-weight:500; padding:0.5rem 1rem; border-radius:var(--radius-control); border:none; cursor:pointer;"
        >
          Load video
        </button>
      </div>
    </div>
  `;

  document.getElementById("video-consent-btn").addEventListener("click", () => {
    container.innerHTML = `
      <div style="position:relative; width:100%; border-radius:0.75rem; overflow:hidden; padding-top:56.25%;">
        <iframe
          style="position:absolute; top:0; left:0; width:100%; height:100%; border-radius:0.75rem; border:none;"
          src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1"
          title="Task video guide"
          frameborder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen>
        </iframe>
      </div>
      <p style="font-size:0.75rem; color:var(--color-video-text-muted); margin-top:0.25rem;">Video starts muted (browser autoplay policy) — use the volume icon inside the player to unmute.</p>
    `;
  });
}

function getTaskIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

async function loadTaskDetail() {
  const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

  if (authError || !user) {
    window.location.href = "onboarding.html";
    return;
  }

  // Populates the sidebar identity strip and shows the correct nav
  // links for whoever is actually viewing this task — same pattern as
  // dashboard.js, since this page can in principle be reached by any
  // signed-in role via a shared link.
  const { data: sidebarProfile } = await supabaseClient
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  const roleLabels = {
    app_manager: "App Manager",
    super_admin: "Super Admin"
  };
  const sidebarEmailEl = document.getElementById("sidebar-user-email");
  const sidebarRolePillEl = document.getElementById("sidebar-role-pill");
  if (sidebarEmailEl) sidebarEmailEl.textContent = user.email || "Unknown user";
  if (sidebarRolePillEl) sidebarRolePillEl.textContent = roleLabels[sidebarProfile?.role] || "Newcomer";

  if (sidebarProfile?.role === "app_manager") {
    document.getElementById("app-manager-link")?.classList.remove("hidden");
    document.getElementById("dashboard-nav-link")?.classList.add("hidden");
  }
  if (sidebarProfile?.role === "super_admin") {
    document.getElementById("super-admin-link")?.classList.remove("hidden");
    document.getElementById("dashboard-nav-link")?.classList.add("hidden");
  }

  const taskId = getTaskIdFromUrl();

  if (!taskId) {
    document.querySelector(".max-w-xl").innerHTML = `<p class="text-sm text-red-600">No task specified.</p>`;
    return;
  }

  const { data: task, error: taskError } = await supabaseClient
    .from("tasks")
    .select("*, task_links(url, label), task_youtube_videos(youtube_video_id)")
    .eq("id", taskId)
    .single();

  if (taskError || !task) {
    console.error(taskError);
    document.querySelector(".max-w-xl").innerHTML = `<p class="text-sm text-red-600">Task not found.</p>`;
    return;
  }

  // SE2L-60: preview mode — shown when opened from the App Manager preview
  // tool. Adds a banner and disables writing real completion state, so
  // App Managers can QA content without affecting real user data.
  const isPreview = new URLSearchParams(window.location.search).get("preview") === "1";
  if (isPreview) {
    const banner = document.createElement("div");
    banner.style.cssText = "background:#eef2ff; color:#4338ca; font-size:0.8rem; font-weight:500; padding:0.5rem 0.75rem; border-radius:0.5rem; margin-bottom:1rem;";
    banner.textContent = `Preview mode — this is how the task appears to a newcomer. Nothing you do here is saved.` + (task.status !== "published" ? ` (Currently ${task.status.replace("_", " ")}, not live yet.)` : "");
    document.querySelector(".max-w-xl").prepend(banner);

    const backLink = document.getElementById("back-link");
    if (backLink) {
      backLink.href = "app-manager.html";
      backLink.textContent = "← Back to App Manager";
    }
  }

  const minorTag = task.is_minor_task ? ` · <span class="text-indigo-600">For your family</span>` : "";
  document.getElementById("task-meta").innerHTML = `${task.urgency} · ${task.category || "General"}${minorTag}`;
  document.getElementById("task-title").textContent = task.title;
  document.getElementById("task-time").textContent = task.time_estimate_minutes
    ? `Estimated time: ${task.time_estimate_minutes} minutes`
    : "";

  const bodyDiv = document.getElementById("task-body");
  if (task.body_html) {
    const formatted = task.body_html
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => {
        if (line.startsWith("- ")) {
          return `<li class="ml-4 list-disc">${line.substring(2)}</li>`;
        }
        return `<p class="mb-2">${line}</p>`;
      })
      .join("");
    bodyDiv.innerHTML = formatted;
  } else {
    bodyDiv.innerHTML = `<p class="text-slate-400">No detailed guidance added yet for this task.</p>`;
  }

  const videoId = task.task_youtube_videos?.[0]?.youtube_video_id;
  const videoContainer = document.getElementById("task-video-container");
  if (videoId) {
    renderVideoConsentGate(videoContainer, videoId);
  }

  const linkUrl = task.task_links?.[0]?.url;
  const linkContainer = document.getElementById("task-link-container");
  if (linkUrl) {
    linkContainer.innerHTML = `
      <a href="${linkUrl}" target="_blank" rel="noopener" class="text-sm text-indigo-600 font-medium flex items-center gap-1">
        ${task.task_links[0].label || "More info"} ↗
      </a>
    `;
  }

  // --- SE2L-44: bookmark and personal notes ---
  // Strictly private per user — task_bookmarks RLS scopes every row to
  // user_id = auth.uid(), so App Managers/Super Admins never see this.
  const { data: existingBookmark } = await supabaseClient
    .from("task_bookmarks")
    .select("*")
    .eq("user_id", user.id)
    .eq("task_id", taskId)
    .maybeSingle();

  const bookmarkBtn = document.getElementById("bookmark-btn");
  const noteTextarea = document.getElementById("personal-note");
  const saveNoteBtn = document.getElementById("save-note-btn");

  let isBookmarked = existingBookmark?.is_bookmarked || false;
  noteTextarea.value = existingBookmark?.personal_note || "";

  function setBookmarkButtonState(bookmarked) {
    bookmarkBtn.textContent = bookmarked ? "★ Bookmarked" : "☆ Bookmark";
    bookmarkBtn.classList.toggle("text-amber-500", bookmarked);
    bookmarkBtn.classList.toggle("text-slate-400", !bookmarked);
  }
  setBookmarkButtonState(isBookmarked);

  async function saveBookmarkState(nextIsBookmarked) {
    const { error } = await supabaseClient
      .from("task_bookmarks")
      .upsert({
        user_id: user.id,
        task_id: taskId,
        is_bookmarked: nextIsBookmarked,
        personal_note: noteTextarea.value || null,
        updated_at: new Date().toISOString()
      }, { onConflict: "user_id,task_id" });

    return error;
  }

  if (isPreview) {
    [bookmarkBtn, noteTextarea, saveNoteBtn].forEach(el => {
      el.disabled = true;
      el.style.opacity = "0.5";
      el.style.cursor = "not-allowed";
    });
    bookmarkBtn.title = "Disabled in preview mode";
  } else {
    bookmarkBtn.addEventListener("click", async () => {
      isBookmarked = !isBookmarked;
      setBookmarkButtonState(isBookmarked);
      const error = await saveBookmarkState(isBookmarked);
      if (error) {
        console.error(error);
        alert("Could not update bookmark.");
      }
    });

    saveNoteBtn.addEventListener("click", async () => {
      const error = await saveBookmarkState(isBookmarked);
      if (error) {
        console.error(error);
        alert("Could not save note.");
      } else {
        saveNoteBtn.textContent = "Saved ✓";
        setTimeout(() => { saveNoteBtn.textContent = "Save note"; }, 1500);
      }
    });
  }

  const { data: existingState } = await supabaseClient
    .from("user_task_state")
    .select("*")
    .eq("user_id", user.id)
    .eq("task_id", taskId)
    .maybeSingle();

  const markCompleteBtn = document.getElementById("mark-complete-btn");

  function setButtonState(isComplete) {
    if (isComplete) {
      markCompleteBtn.textContent = "✓ Completed";
      markCompleteBtn.classList.add("bg-green-600");
      markCompleteBtn.classList.remove("bg-slate-900");
    } else {
      markCompleteBtn.textContent = "✓ Mark complete";
      markCompleteBtn.classList.add("bg-slate-900");
      markCompleteBtn.classList.remove("bg-green-600");
    }
  }

  let isComplete = existingState && existingState.status === "complete";
  setButtonState(isComplete);

  if (isPreview) {
    markCompleteBtn.disabled = true;
    markCompleteBtn.style.opacity = "0.5";
    markCompleteBtn.style.cursor = "not-allowed";
    markCompleteBtn.title = "Disabled in preview mode";
  } else {
    markCompleteBtn.addEventListener("click", async () => {
      isComplete = !isComplete;
      setButtonState(isComplete);

      const { error: upsertError } = await supabaseClient
        .from("user_task_state")
        .upsert({
          user_id: user.id,
          task_id: taskId,
          status: isComplete ? "complete" : "pending",
          completed_at: isComplete ? new Date().toISOString() : null
        });

      if (upsertError) {
        console.error(upsertError);
        alert("Could not update task status.");
      }
    });
  }
  // --- SE2L-45: thumbs up/down feedback with optional comment ---
  // Visible to App Managers/Super Admins (see task_feedback RLS), unlike
  // the strictly-private bookmarks/notes above.
  const { data: existingFeedback } = await supabaseClient
    .from("task_feedback")
    .select("*")
    .eq("user_id", user.id)
    .eq("task_id", taskId)
    .maybeSingle();

  const thumbsUpBtn = document.getElementById("thumbs-up-btn");
  const thumbsDownBtn = document.getElementById("thumbs-down-btn");
  const feedbackComment = document.getElementById("feedback-comment");
  const saveFeedbackBtn = document.getElementById("save-feedback-btn");

  let currentRating = existingFeedback?.rating || null;
  feedbackComment.value = existingFeedback?.comment || "";

  function setFeedbackButtonState(rating) {
    thumbsUpBtn.classList.toggle("bg-green-50", rating === "up");
    thumbsUpBtn.classList.toggle("border-green-600", rating === "up");
    thumbsUpBtn.classList.toggle("text-green-700", rating === "up");

    thumbsDownBtn.classList.toggle("bg-red-50", rating === "down");
    thumbsDownBtn.classList.toggle("border-red-600", rating === "down");
    thumbsDownBtn.classList.toggle("text-red-700", rating === "down");
  }
  setFeedbackButtonState(currentRating);

  async function saveFeedbackState(rating) {
    const { error } = await supabaseClient
      .from("task_feedback")
      .upsert({
        user_id: user.id,
        task_id: taskId,
        rating: rating,
        comment: feedbackComment.value || null,
        updated_at: new Date().toISOString()
      }, { onConflict: "user_id,task_id" });

    return error;
  }

  if (isPreview) {
    [thumbsUpBtn, thumbsDownBtn, feedbackComment, saveFeedbackBtn].forEach(el => {
      el.disabled = true;
      el.style.opacity = "0.5";
      el.style.cursor = "not-allowed";
    });
  } else {
    thumbsUpBtn.addEventListener("click", async () => {
      currentRating = currentRating === "up" ? null : "up";
      setFeedbackButtonState(currentRating);
      const error = await saveFeedbackState(currentRating);
      if (error) {
        console.error(error);
        alert("Could not save feedback.");
      }
    });

    thumbsDownBtn.addEventListener("click", async () => {
      currentRating = currentRating === "down" ? null : "down";
      setFeedbackButtonState(currentRating);
      const error = await saveFeedbackState(currentRating);
      if (error) {
        console.error(error);
        alert("Could not save feedback.");
      }
    });

    saveFeedbackBtn.addEventListener("click", async () => {
      const error = await saveFeedbackState(currentRating);
      if (error) {
        console.error(error);
        alert("Could not save feedback.");
      } else {
        saveFeedbackBtn.textContent = "Saved ✓";
        setTimeout(() => { saveFeedbackBtn.textContent = "Save feedback"; }, 1500);
      }
    });
  }
}

loadTaskDetail();