// Shared shell behavior for the sidebar/mobile-drawer layout.
// One file, included on every page that uses the shell, so behavior can't
// drift between pages. Purely presentational plus the one truly
// cross-page action (sign out) — no other page-specific logic belongs here.

// --- Identity cache: paints the sidebar email/avatar/role instantly from
// the last-known value (sessionStorage), before this page's own auth
// check finishes. Each page's own identity-fetch code is unchanged — it
// still runs and is still the source of truth; it just also calls
// window.se2lCacheIdentity() once it has the real answer, so the *next*
// page load in this session can paint instantly instead of showing
// "Loading…" while the network round-trip completes. First page load in
// a session (empty cache) still has the normal brief delay — unavoidable,
// since there's no prior answer to paint from yet.
(function paintCachedIdentity() {
  try {
    const cached = JSON.parse(sessionStorage.getItem("se2l_identity_cache") || "null");
    if (!cached) return;
    const emailEl = document.getElementById("sidebar-user-email");
    const roleEl = document.getElementById("sidebar-role-pill");
    const avatarEl = document.getElementById("sidebar-identity-avatar");
    if (emailEl && cached.email) emailEl.textContent = cached.email;
    if (roleEl && cached.roleLabel) roleEl.textContent = cached.roleLabel;
    if (avatarEl && cached.initials) avatarEl.textContent = cached.initials;
  } catch (err) {
    // Corrupt/unavailable sessionStorage — silently skip, page still works,
    // just falls back to the normal "Loading…" until the real fetch resolves.
  }
})();

window.se2lCacheIdentity = function (email, roleLabel) {
  try {
    const namePart = (email || "").split("@")[0];
    const initials = namePart.replace(/[^a-zA-Z]/g, " ").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
    sessionStorage.setItem("se2l_identity_cache", JSON.stringify({
      email,
      roleLabel,
      initials: initials || namePart.slice(0, 2).toUpperCase(),
    }));
  } catch (err) {
    // sessionStorage unavailable (private browsing, etc.) — caching is a
    // nice-to-have, not required, so fail silently.
  }
};

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