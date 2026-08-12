const CATEGORIES = ["Housing", "Legal", "Banking", "Healthcare", "Education", "Employment", "Social"];

let allResources = [];
let currentCategory = "All";
let currentSearchTerm = "";

function renderCategoryPills() {
  const container = document.getElementById("category-pills");
  const pills = ["All", ...CATEGORIES];

  container.innerHTML = pills.map(cat => {
    const isActive = cat === currentCategory;
    return `<button type="button" data-category="${cat}" class="resource-pill ${isActive ? "is-active" : ""}">${cat}</button>`;
  }).join("");

  container.querySelectorAll("[data-category]").forEach(btn => {
    btn.addEventListener("click", () => {
      currentCategory = btn.dataset.category;
      renderCategoryPills();
      renderFilteredResources();
    });
  });
}

function renderFilteredResources() {
  const listDiv = document.getElementById("resource-list");

  const filtered = allResources.filter(r => {
    const matchesCategory = currentCategory === "All" || r.category === currentCategory;
    const term = currentSearchTerm.toLowerCase();
    const matchesSearch = !term ||
      r.title.toLowerCase().includes(term) ||
      (r.description || "").toLowerCase().includes(term);
    return matchesCategory && matchesSearch;
  });

  if (filtered.length === 0) {
    listDiv.innerHTML = `<p class="text-sm text-slate-400 col-span-2">No resources match your search.</p>`;
    return;
  }

  const categoryIcons = {
    Healthcare: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21C12 21 4 15.5 4 9.5a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9.5C20 15.5 12 21 12 21z"/></svg>`,
    Banking: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="10" width="18" height="9" rx="1"/><path d="M3 10L12 4l9 6"/></svg>`,
    Housing: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>`,
    Legal: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18"/><path d="M5 8l-3 5a3 3 0 0 0 6 0z"/><path d="M19 8l-3 5a3 3 0 0 0 6 0z"/><path d="M5 8h14"/></svg>`,
    Education: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"/></svg>`,
    Employment: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`,
    Social: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    default: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`
  };

  const cardHtml = (r) => {
    const draftTag = r.status === "draft" ? ` <span class="text-amber-600">(Draft)</span>` : "";
    const linkRow = r.url
      ? `<a href="${r.url}" target="_blank" rel="noopener" class="resource-card-link">More info <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 17L17 7M17 7H8M17 7v9"/></svg></a>`
      : "";
    const icon = categoryIcons[r.category] || categoryIcons.default;
    return `
      <div class="card resource-card">
        <div class="icon-tile icon-tile-mint">${icon}</div>
        <span class="text-xs text-indigo-600 font-medium">${r.category}${draftTag}</span>
        <p class="text-sm font-medium mt-1">${r.title}</p>
        <p class="text-xs text-slate-500 mt-1">${r.description || ""}</p>
        ${linkRow}
      </div>
    `;
  };

  // Featured card: only on the default unfiltered view (no category
  // filter, no search term) — highlighting a filtered/searched result
  // as "featured" wouldn't make sense, so it only shows here.
  const isDefaultView = currentCategory === "All" && !currentSearchTerm;
  if (isDefaultView && filtered.length > 1) {
    const [featured, ...rest] = filtered;
    const featuredLink = featured.url
      ? `<a href="${featured.url}" target="_blank" rel="noopener" class="resource-featured-link">Read guide <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 17L17 7M17 7H8M17 7v9"/></svg></a>`
      : "";
    listDiv.innerHTML = `
      <div class="card card-accent resource-featured">
        <span class="text-xs" style="color: rgba(255,255,255,0.7);">${featured.category}</span>
        <p class="resource-featured-title">${featured.title}</p>
        <p class="text-sm" style="color: rgba(255,255,255,0.8); margin-top: 0.35rem;">${featured.description || ""}</p>
        ${featuredLink}
      </div>
    ` + rest.map(cardHtml).join("");
  } else {
    listDiv.innerHTML = filtered.map(cardHtml).join("");
  }
}

async function loadResources() {
  const listDiv = document.getElementById("resource-list");

  // RLS handles visibility: published-only for the public, published+draft
  // for a logged-in app_manager — no need to branch this query on role.
  const { data, error } = await supabaseClient
    .from("resources")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    listDiv.innerHTML = `<p class="text-sm text-red-600 col-span-2">Could not load resources.</p>`;
    console.error(error);
    return;
  }

  allResources = data || [];
  renderFilteredResources();
}

async function checkAuthAndActivateShell() {
  // Intentionally does NOT redirect if nobody's logged in — this page stays
  // public. Only removes shell-inactive (revealing the sidebar/topbar) for
  // a confirmed session; app_manager-only pieces (Manage content link,
  // the add-resource form) stay hidden unless the role check below passes.
  // getSession() reads the persisted session from local storage rather
  // than round-tripping to the auth server like getUser() does — since
  // this call only decides whether to reveal the sidebar (not gate
  // access to anything sensitive; RLS still does that), the extra
  // network wait getUser() adds isn't needed and was the actual cause
  // of the visible flash between the public and signed-in layouts.
  const { data: { session } } = await supabaseClient.auth.getSession();
  const user = session?.user;
  if (!user) return;

  document.body.classList.remove("shell-inactive");

  const { data: profile } = await supabaseClient
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  const backLink = document.getElementById("back-link");
  const dashboardNavLink = document.getElementById("dashboard-nav-link");

  const roleLabels = {
    app_manager: "App Manager",
    super_admin: "Super Admin"
  };
  const emailEl = document.getElementById("sidebar-user-email");
  const rolePillEl = document.getElementById("sidebar-role-pill");
  const avatarEl = document.getElementById("sidebar-identity-avatar");
  if (emailEl) emailEl.textContent = user.email || "Unknown user";
  if (rolePillEl) rolePillEl.textContent = roleLabels[profile?.role] || "Newcomer";
  if (avatarEl && user.email) {
    const namePart = user.email.split("@")[0];
    const initials = namePart.replace(/[^a-zA-Z]/g, " ").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
    avatarEl.textContent = initials || namePart.slice(0, 2).toUpperCase();
  }
  window.se2lCacheIdentity?.(user.email, roleLabels[profile?.role] || "Newcomer");

  if (profile?.role === "super_admin") {
    document.getElementById("super-admin-link")?.classList.remove("hidden");

    // Super Admins land here from their own dashboard — send them back
    // there instead of the newcomer dashboard.
    if (backLink) {
      backLink.href = "super-admin.html";
      backLink.textContent = "← Back to platform overview";
    }
  } else if (profile?.role === "app_manager") {
    document.getElementById("app-manager-link")?.classList.remove("hidden");
    document.getElementById("add-resource-section").classList.remove("hidden");

    // App Managers land here from their own dashboard — send them back
    // there instead of the public landing page.
    if (backLink) {
      backLink.href = "app-manager.html";
      backLink.textContent = "← Back to app manager dashboard";
    }
  } else if (backLink && profile?.role !== "super_admin") {
    // Any other logged-in (non-app_manager, non-super_admin) user gets
    // their real dashboard instead of the public landing page.
    backLink.href = "dashboard.html";
    backLink.textContent = "← Back to dashboard";
    dashboardNavLink?.classList.remove("hidden");
  }
}

document.getElementById("resource-search").addEventListener("input", (e) => {
  currentSearchTerm = e.target.value;
  renderFilteredResources();
});

document.getElementById("resource-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const title = document.getElementById("resource_title").value.trim();
  const description = document.getElementById("resource_description").value.trim();
  const category = document.getElementById("resource_category").value;
  const status = document.getElementById("resource_status").value;
  const url = document.getElementById("resource_url").value.trim();

  if (!title) {
    alert("Please enter a title.");
    return;
  }

  const { error } = await supabaseClient
    .from("resources")
    .insert({
      title,
      description: description || null,
      category,
      status,
      url: url || null
    });

  if (error) {
    alert("Could not save resource: " + error.message);
    return;
  }

  alert("Resource saved.");
  document.getElementById("resource-form").reset();
  await loadResources();
});

renderCategoryPills();
loadResources();
checkAuthAndActivateShell();