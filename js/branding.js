// SE2L-77: shared branding loader, included on every page (after
// supabase-config.js). Fetches the single platform_settings row and:
//   1. Overrides the --color-accent-dark CSS variable, so buttons/
//      headings/nav highlights pick up the Super Admin's chosen color
//      without any page needing its own logic.
//   2. Updates the site-name wordmark, wherever one exists on the
//      current page — checks each known wordmark class rather than
//      requiring every page to add a new one.
//   3. Updates any "Contact Support" footer link (marked with
//      id="footer-support-link") to a real mailto: link.
// Safe to include everywhere: if a page has none of these elements,
// this simply does nothing for that part.

async function loadBranding() {
  const { data: settings, error } = await supabaseClient
    .from("platform_settings")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error || !settings) return;

  if (settings.accent_color) {
    document.documentElement.style.setProperty("--color-accent-dark", settings.accent_color);
  }

  if (settings.site_name) {
    const wordmarkSelectors = [
      ".app-sidebar-title",
      ".login-header-title",
      ".onboarding-header-title",
      ".landing-header-title"
    ];
    document.querySelectorAll(wordmarkSelectors.join(",")).forEach(el => {
      el.textContent = settings.site_name;
    });
  }

  if (settings.support_email) {
    const supportLink = document.getElementById("footer-support-link");
    if (supportLink) {
      supportLink.href = `mailto:${settings.support_email}`;
    }
  }
}

loadBranding();