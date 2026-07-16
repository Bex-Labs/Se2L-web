// Shared shell behavior for the sidebar/mobile-drawer layout.
// One file, included on every page that uses the shell, so the open/close
// behavior can't drift between pages as the shell rolls out beyond the
// dashboard. Purely presentational — no Supabase calls, no page-specific
// logic belongs here.

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

// Close the drawer automatically if the viewport is resized past the
// mobile breakpoint while it's open, so it doesn't get stuck open
// underneath the now-visible desktop sidebar.
window.addEventListener("resize", () => {
  if (window.innerWidth >= 768) closeSidebar();
});