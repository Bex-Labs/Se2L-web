function renderVideoConsentGate(container, videoId) {
  const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

  container.innerHTML = `
    <div class="relative w-full rounded-xl overflow-hidden bg-slate-900" style="padding-top: 56.25%;">
      <img
        src="${thumbnailUrl}"
        alt="Video preview"
        class="absolute top-0 left-0 w-full h-full object-cover opacity-60"
      />
      <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
        <div class="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center">
          <span class="text-slate-900 text-xl ml-1">▶</span>
        </div>
        <p class="text-white text-sm font-medium">This task includes a YouTube video</p>
        <p class="text-white/80 text-xs max-w-xs">
          Playing it will load content from YouTube, which uses cookies and may collect data per Google's privacy policy.
        </p>
        <button
          id="video-consent-btn"
          class="bg-white text-slate-900 text-sm font-medium px-4 py-2 rounded-lg"
        >
          Load video
        </button>
      </div>
    </div>
  `;

  document.getElementById("video-consent-btn").addEventListener("click", () => {
    container.innerHTML = `
      <div class="relative w-full rounded-xl overflow-hidden" style="padding-top: 56.25%;">
        <iframe
          class="absolute top-0 left-0 w-full h-full rounded-xl"
          src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1"
          title="Task video guide"
          frameborder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen>
        </iframe>
      </div>
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

loadTaskDetail();