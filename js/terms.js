async function loadLegalPage() {
  const { data: page, error } = await supabaseClient
    .from("legal_pages")
    .select("*")
    .eq("slug", "terms")
    .single();

  if (error || !page) {
    document.getElementById("legal-page-title").textContent = "Page not found";
    document.getElementById("legal-page-body").innerHTML = `<p class="text-slate-400">This page hasn't been set up yet.</p>`;
    return;
  }

  document.title = `Se2L — ${page.title}`;
  document.getElementById("legal-page-title").textContent = page.title;
  document.getElementById("legal-page-updated").textContent = `Last updated ${new Date(page.updated_at).toLocaleDateString(undefined, { dateStyle: "long" })}`;

  const bodyDiv = document.getElementById("legal-page-body");
  if (page.body_html) {
    // Same lightweight formatting as task-detail.js: plain text with
    // "- " prefixed lines rendered as a bullet list.
    const formatted = page.body_html
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
    bodyDiv.innerHTML = `<p class="text-slate-400">No content added yet.</p>`;
  }
}

loadLegalPage();