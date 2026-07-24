const CATEGORIES = ["Housing", "Legal", "Banking", "Healthcare", "Education", "Employment", "Social"];

let allResources = [];
let currentCategory = "All";
let currentSearchTerm = "";

function renderCategoryPills() {
  const container = document.getElementById("category-pills");
  const pills = ["All", ...CATEGORIES];

  container.innerHTML = pills.map(cat => {
    const isActive = cat === currentCategory;
    return `<button type="button" data-category="${cat}" class="text-xs px-3 py-1.5 rounded-full ${isActive ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}">${cat}</button>`;
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

  listDiv.innerHTML = filtered.map(r => {
    const draftTag = r.status === "draft" ? ` <span class="text-amber-600">(Draft)</span>` : "";
    const linkRow = r.url
      ? `<a href="${r.url}" target="_blank" rel="noopener" class="text-xs text-indigo-600 font-medium mt-1 block">More info ↗</a>`
      : "";
    return `
      <div class="bg-white border border-slate-200 rounded-xl p-4">
        <span class="text-xs text-indigo-600 font-medium">${r.category}${draftTag}</span>
        <p class="text-sm font-medium mt-1">${r.title}</p>
        <p class="text-xs text-slate-500 mt-1">${r.description || ""}</p>
        ${linkRow}
      </div>
    `;
  }).join("");
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
  const { data: { user } } = await supabaseClient.auth.getUser();
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
  if (emailEl) emailEl.textContent = user.email || "Unknown user";
  if (rolePillEl) rolePillEl.textContent = roleLabels[profile?.role] || "Newcomer";

  if (profile?.role === "super_admin") {
    document.getElementById("super-admin-link")?.classList.remove("hidden");
    dashboardNavLink?.classList.add("hidden");

    // Super Admins land here from their own dashboard — send them back
    // there instead of the newcomer dashboard.
    if (backLink) {
      backLink.href = "super-admin.html";
      backLink.textContent = "← Back to platform overview";
    }
  }

  if (profile?.role === "app_manager") {
    document.getElementById("app-manager-link")?.classList.remove("hidden");
    document.getElementById("add-resource-section").classList.remove("hidden");
    dashboardNavLink?.classList.add("hidden");

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