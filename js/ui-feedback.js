// --- Shared in-app feedback: toasts + confirm/prompt modals ---
//
// Replaces window.alert()/confirm()/prompt() throughout the app. Native
// browser dialogs look out of place next to the rest of the styled UI,
// block the whole page, and can't be dismissed/styled consistently.
// This gives every page the same three primitives instead:
//
//   window.se2lToast(message, type)          — non-blocking notification
//   window.se2lConfirm(message, opts)         — returns Promise<boolean>
//   window.se2lPrompt(message, opts)          — returns Promise<string|null>
//
// Both se2lConfirm and se2lPrompt are awaitable, so existing call sites
// convert directly: `if (!confirm(x)) return;` becomes
// `if (!(await se2lConfirm(x))) return;` — same shape, just async.
//
// Include this script on any page that needs it, after supabase-config.js
// and before the page's own script (order doesn't actually matter here
// since nothing runs until these functions are called, but keeping it
// near the top with the other shared scripts is the established pattern).

(function () {
  let toastContainer = null;
  let modalRoot = null;

  function ensureToastContainer() {
    if (toastContainer) return toastContainer;
    toastContainer = document.createElement("div");
    toastContainer.id = "se2l-toast-container";
    toastContainer.style.cssText = `
      position: fixed;
      top: 1rem;
      right: 1rem;
      z-index: 2000;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      max-width: 22rem;
      width: calc(100% - 2rem);
    `;
    document.body.appendChild(toastContainer);
    return toastContainer;
  }

  const TOAST_STYLES = {
    success: { bg: "var(--color-accent-bg, #d9f2e2)", fg: "var(--color-accent-dark, #22824a)", border: "var(--color-accent, #2fae63)" },
    error: { bg: "var(--color-critical-bg, #f7ddd8)", fg: "var(--color-critical, #c1483a)", border: "var(--color-critical, #c1483a)" },
    info: { bg: "var(--color-navy-bg, #e7e9f2)", fg: "var(--color-navy, #0f1a44)", border: "var(--color-navy, #0f1a44)" }
  };

  // type: "success" | "error" | "info" (defaults to "info")
  window.se2lToast = function (message, type) {
    const container = ensureToastContainer();
    const style = TOAST_STYLES[type] || TOAST_STYLES.info;

    const toast = document.createElement("div");
    toast.setAttribute("role", "status");
    toast.style.cssText = `
      background: ${style.bg};
      color: ${style.fg};
      border-left: 3px solid ${style.border};
      border-radius: var(--radius-control, 0.5rem);
      padding: 0.75rem 1rem;
      font-size: 0.875rem;
      line-height: 1.4;
      box-shadow: 0 4px 16px rgba(15, 23, 42, 0.12);
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.75rem;
      animation: se2l-toast-in 0.2s ease-out;
    `;

    const textSpan = document.createElement("span");
    textSpan.textContent = message;
    textSpan.style.flex = "1";

    const closeBtn = document.createElement("button");
    closeBtn.setAttribute("aria-label", "Dismiss");
    closeBtn.textContent = "×";
    closeBtn.style.cssText = `
      background: none; border: none; cursor: pointer;
      font-size: 1.1rem; line-height: 1; color: inherit;
      opacity: 0.6; padding: 0; flex-shrink: 0;
    `;
    closeBtn.addEventListener("click", () => toast.remove());

    toast.appendChild(textSpan);
    toast.appendChild(closeBtn);
    container.appendChild(toast);

    const autoDismissMs = type === "error" ? 7000 : 4500;
    setTimeout(() => toast.remove(), autoDismissMs);
  };

  function ensureModalRoot() {
    if (modalRoot) return modalRoot;
    modalRoot = document.createElement("div");
    modalRoot.id = "se2l-modal-root";
    modalRoot.style.cssText = `
      position: fixed; inset: 0; background: rgba(15, 23, 42, 0.5);
      display: none; align-items: center; justify-content: center;
      z-index: 2100; padding: 1rem;
    `;
    document.body.appendChild(modalRoot);
    return modalRoot;
  }

  // opts: { confirmLabel, cancelLabel, danger }
  window.se2lConfirm = function (message, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const root = ensureModalRoot();
      root.innerHTML = "";

      const card = document.createElement("div");
      card.className = "card";
      card.style.cssText = "width: 100%; max-width: 24rem;";

      const text = document.createElement("p");
      text.className = "text-sm";
      text.style.marginBottom = "1.25rem";
      text.textContent = message;

      const actions = document.createElement("div");
      actions.style.cssText = "display: flex; justify-content: flex-end; gap: 0.5rem;";

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "btn btn-secondary btn-sm";
      cancelBtn.textContent = opts.cancelLabel || "Cancel";

      const confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.className = opts.danger ? "btn btn-sm" : "btn btn-primary btn-sm";
      if (opts.danger) confirmBtn.style.cssText = "background: var(--color-critical); color: #fff;";
      confirmBtn.textContent = opts.confirmLabel || "Confirm";

      function close(result) {
        root.style.display = "none";
        resolve(result);
      }

      cancelBtn.addEventListener("click", () => close(false));
      confirmBtn.addEventListener("click", () => close(true));
      root.addEventListener("click", function overlayClick(e) {
        if (e.target === root) {
          close(false);
          root.removeEventListener("click", overlayClick);
        }
      });

      actions.appendChild(cancelBtn);
      actions.appendChild(confirmBtn);
      card.appendChild(text);
      card.appendChild(actions);
      root.appendChild(card);
      root.style.display = "flex";
      confirmBtn.focus();
    });
  };

  // opts: { heading, placeholder, confirmLabel, cancelLabel, required }
  // Resolves the typed string, or null if cancelled. If opts.required
  // is true (default), an empty submission re-shows an inline error
  // instead of resolving — matching the pattern already used for
  // App Manager rejection reasons.
  window.se2lPrompt = function (message, opts) {
    opts = opts || {};
    const required = opts.required !== false;

    return new Promise((resolve) => {
      const root = ensureModalRoot();
      root.innerHTML = "";

      const card = document.createElement("div");
      card.className = "card";
      card.style.cssText = "width: 100%; max-width: 26rem;";

      if (opts.heading) {
        const heading = document.createElement("h2");
        heading.style.cssText = "font-family: var(--font-heading); font-weight: 700; font-size: 1.1rem; margin-bottom: 0.35rem;";
        heading.textContent = opts.heading;
        card.appendChild(heading);
      }

      const text = document.createElement("p");
      text.className = "text-sm text-slate-500";
      text.style.marginBottom = "0.75rem";
      text.textContent = message;
      card.appendChild(text);

      const textarea = document.createElement("textarea");
      textarea.className = "form-textarea";
      textarea.rows = 3;
      textarea.placeholder = opts.placeholder || "";
      card.appendChild(textarea);

      const errorEl = document.createElement("p");
      errorEl.className = "text-sm";
      errorEl.style.cssText = "color: var(--color-critical); margin-top: 0.5rem; display: none;";
      errorEl.textContent = "Please fill this in before continuing.";
      card.appendChild(errorEl);

      const actions = document.createElement("div");
      actions.style.cssText = "display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem;";

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "btn btn-secondary btn-sm";
      cancelBtn.textContent = opts.cancelLabel || "Cancel";

      const confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.className = "btn btn-primary btn-sm";
      confirmBtn.textContent = opts.confirmLabel || "Confirm";

      function close(result) {
        root.style.display = "none";
        resolve(result);
      }

      cancelBtn.addEventListener("click", () => close(null));
      confirmBtn.addEventListener("click", () => {
        const value = textarea.value.trim();
        if (required && !value) {
          errorEl.style.display = "block";
          textarea.focus();
          return;
        }
        close(value);
      });
      textarea.addEventListener("input", () => { errorEl.style.display = "none"; });
      root.addEventListener("click", function overlayClick(e) {
        if (e.target === root) {
          close(null);
          root.removeEventListener("click", overlayClick);
        }
      });

      actions.appendChild(cancelBtn);
      actions.appendChild(confirmBtn);
      card.appendChild(actions);
      root.appendChild(card);
      root.style.display = "flex";
      textarea.focus();
    });
  };

  // Minimal keyframes for the toast entrance, injected once.
  const styleEl = document.createElement("style");
  styleEl.textContent = `
    @keyframes se2l-toast-in {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(styleEl);
})();