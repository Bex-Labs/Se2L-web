// Shared shell behavior for the sidebar/mobile-drawer layout.
// One file, included on every page that uses the shell, so behavior can't
// drift between pages. Purely presentational plus the one truly
// cross-page action (sign out) — no other page-specific logic belongs here.

function openSidebar() {
  document.getElementById("app-sidebar")?.classList.add("open");
  document.getElementById("sidebar-backdrop")?.classList.add("open");
}

function closeSidebar() {
  document.getElementById("app-sidebar")?.classList.remove("open");
  document.getElementById("sidebar-backdrop")?.classList.remove("open");
}

document.getElementById("mobile-menu-btn")?.addEventListener("click", openSidebar);
document.getElementById("sidebar-backdrop")?.addEventListener("click", closeSidebar);

window.addEventListener("resize", () => {
  if (window.innerWidth >= 768) closeSidebar();
});

// Sign out — shared across every shelled page rather than duplicated per
// page's own JS file. Guarded in case a page hasn't loaded supabase-config.js.
document.getElementById("signout-btn")?.addEventListener("click", async () => {
  if (typeof supabaseClient === "undefined") {
    console.error("supabaseClient not loaded on this page.");
    return;
  }
  await supabaseClient.auth.signOut();
  window.location.href = "login.html";
});