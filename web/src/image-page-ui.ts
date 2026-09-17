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

function setStyle(element: HTMLElement, property: string, value: string): void {
  if (element.style.getPropertyValue(property) !== value) element.style.setProperty(property, value, "important");
}

function makeFullPageSurface(element: HTMLElement): void {
  setStyle(element, "box-sizing", "border-box");
  setStyle(element, "width", "100%");
  setStyle(element, "height", "100%");
  setStyle(element, "min-width", "0");
  setStyle(element, "min-height", "0");
  setStyle(element, "max-width", "none");
  setStyle(element, "max-height", "none");
  setStyle(element, "margin", "0");
  setStyle(element, "padding", "0");
  setStyle(element, "border", "0");
  setStyle(element, "background", "#fff");
  setStyle(element, "overflow", "hidden");
}

const previewObservers = new WeakMap<Document, MutationObserver>();

function repairPreviewImagePage(frame: HTMLIFrameElement): void {
  const editor = document.querySelector<HTMLElement>(".editor-pane.folio-image-page-mode .folio-image-page-editor");
  if (!editor || !isFullPageImageMarkdown(editor.dataset.markdown ?? "")) return;

  const doc = frame.contentDocument;
  if (!doc?.documentElement || !doc.body) return;

  const section = doc.querySelector<HTMLElement>("main.book > section.image-page")
    ?? doc.querySelector<HTMLElement>("main.book > section.level1, main.book > section.frontmatter");
  if (!section) return;

  const image = section.querySelector<HTMLImageElement>("img.full-page-image, img[data-folio-asset], img");
  if (!image) return;

  section.classList.add("image-page");
  image.classList.add("full-page-image", "fit-contain");
  image.classList.remove("fit-cover", "folio-crop");

  makeFullPageSurface(doc.documentElement);
  makeFullPageSurface(doc.body);
  const main = doc.querySelector<HTMLElement>("main.book");
  if (main) makeFullPageSurface(main);
  makeFullPageSurface(section);

  const paragraph = image.closest<HTMLElement>("p");
  if (paragraph && section.contains(paragraph)) makeFullPageSurface(paragraph);

  const wrapper = image.closest<HTMLElement>("figure, .folio-illustration-preview, .editor-illustration");
  if (wrapper && section.contains(wrapper)) {
    wrapper.classList.add("folio-full-page-preview-art");
    makeFullPageSurface(wrapper);
    setStyle(wrapper, "display", "grid");
    setStyle(wrapper, "place-items", "center");
  }

  setStyle(image, "display", "block");
  setStyle(image, "box-sizing", "border-box");
  setStyle(image, "width", "100%");
  setStyle(image, "height", "100%");
  setStyle(image, "min-width", "0");
  setStyle(image, "min-height", "0");
  setStyle(image, "max-width", "100%");
  setStyle(image, "max-height", "100%");
  setStyle(image, "margin", "0");
  setStyle(image, "padding", "0");
  setStyle(image, "object-fit", "contain");
  setStyle(image, "object-position", "50% 50%");
  setStyle(image, "background", "#fff");

  if (!previewObservers.has(doc)) {
    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        repairPreviewImagePage(frame);
      });
    });
    observer.observe(section, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "src"] });
    previewObservers.set(doc, observer);
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

  const frame = document.querySelector<HTMLIFrameElement>(".preview-frame");
  if (frame) {
    if (!frame.dataset.folioImagePageLoadHook) {
      frame.dataset.folioImagePageLoadHook = "true";
      frame.addEventListener("load", () => requestAnimationFrame(() => repairPreviewImagePage(frame)));
    }
    repairPreviewImagePage(frame);
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
