const FULL_PAGE_IMAGE = /!\[[^\]]*\]\([^)]+\)\{[^}]*\.full-page-image\b[^}]*\}/i;

export function isFullPageImageMarkdown(markdown: string): boolean {
  return FULL_PAGE_IMAGE.test(markdown);
}

function syncDuplicateLabels(root: ParentNode = document): void {
  const labels = Array.from(root.querySelectorAll<HTMLElement>(".contents-list .contents-row:not(.cover-row) .chapter-label, .contents-list .contents-row:not(.cover-row) > span:last-child"));
  const groups = new Map<string, HTMLElement[]>();

  for (const label of labels) {
    const current = (label.textContent ?? "").trim();
    let original = label.dataset.folioOriginalLabel?.trim() ?? "";
    if (!original || (current !== original && !current.startsWith(`${original} · `))) {
      original = current;
      label.dataset.folioOriginalLabel = original;
    }
    if (!original) continue;
    const key = original.toLocaleLowerCase();
    const group = groups.get(key) ?? [];
    group.push(label);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const original = group[0]?.dataset.folioOriginalLabel ?? "";
    group.forEach((label, index) => {
      const next = group.length > 1 && index > 0 ? `${original} · ${index + 1}` : original;
      if (label.textContent !== next) label.textContent = next;
      label.dataset.folioDisambiguated = group.length > 1 ? "true" : "false";
    });
  }
}

function syncImagePageMode(): void {
  const panes = Array.from(document.querySelectorAll<HTMLElement>(".folio-shell .editor-pane"));
  for (const pane of panes) {
    const editor = pane.querySelector<HTMLElement>(".manuscript-editor.rich-editor");
    const markdown = editor?.dataset.markdown ?? "";
    const fullPage = Boolean(editor && isFullPageImageMarkdown(markdown));

    pane.classList.toggle("folio-image-page-mode", fullPage);
    editor?.classList.toggle("folio-image-page-editor", fullPage);

    if (!editor) continue;
    if (fullPage) {
      if (!editor.dataset.folioImagePageRuntimeLock) {
        editor.dataset.folioImagePageRuntimeLock = editor.getAttribute("contenteditable") === "true" ? "editable" : "readonly";
      }
      if (editor.getAttribute("contenteditable") !== "false") editor.setAttribute("contenteditable", "false");
      if (editor.getAttribute("aria-label") !== "Full-page image preview") editor.setAttribute("aria-label", "Full-page image preview");

      const figure = editor.querySelector<HTMLElement>(".editor-illustration");
      if (figure) {
        figure.classList.add("editor-full-page-art");
        figure.dataset.folioFullPage = "true";
        const image = figure.querySelector<HTMLImageElement>("img[data-folio-asset]");
        if (image) {
          image.style.width = "100%";
          image.style.height = "100%";
          image.style.aspectRatio = "auto";
          image.style.objectFit = "contain";
          image.style.objectPosition = "50% 50%";
        }
      }
    } else if (editor.dataset.folioImagePageRuntimeLock) {
      if (editor.dataset.folioImagePageRuntimeLock === "editable" && editor.getAttribute("contenteditable") !== "true") {
        editor.setAttribute("contenteditable", "true");
      }
      delete editor.dataset.folioImagePageRuntimeLock;
      if (editor.getAttribute("aria-label") === "Full-page image preview") editor.removeAttribute("aria-label");
      editor.querySelectorAll<HTMLElement>(".editor-full-page-art").forEach((figure) => {
        figure.classList.remove("editor-full-page-art");
        delete figure.dataset.folioFullPage;
      });
    }
  }

  syncDuplicateLabels();
}

export function installImagePageUiRuntime(): void {
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      syncImagePageMode();
    });
  };

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-markdown", "contenteditable", "class"],
  });
  schedule();
}
