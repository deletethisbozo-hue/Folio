function clamp(value: string | undefined, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

type WrapMode = "none" | "left" | "right";

function ratioCss(value: string): string {
  if (value === "1-1") return "1 / 1";
  if (value === "3-2") return "3 / 2";
  if (value === "2-3") return "2 / 3";
  if (value === "16-9") return "16 / 9";
  return "4 / 3";
}

function wrapMode(figure: HTMLElement): WrapMode {
  return figure.dataset.folioWrap === "left" ? "left" : figure.dataset.folioWrap === "right" ? "right" : "none";
}

function controlsMarkup(): string {
  return `<div class="editor-illustration-controls" contenteditable="false">
    <button type="button" class="illustration-drag-handle" data-folio-control="drag" title="Drag illustration">Move</button>
    <label><span>Wrap</span><select data-folio-control="wrap" aria-label="Text wrap">
      <option value="none">No wrap</option>
      <option value="left">Image left</option>
      <option value="right">Image right</option>
    </select></label>
    <label><span>Size</span><input data-folio-control="scale" type="range" min="25" max="100" step="5"></label>
    <button type="button" data-folio-control="crop" aria-pressed="false">Crop</button>
    <select data-folio-control="ratio" aria-label="Crop ratio">
      <option value="1-1">1:1</option>
      <option value="4-3">4:3</option>
      <option value="3-2">3:2</option>
      <option value="2-3">2:3</option>
      <option value="16-9">16:9</option>
    </select>
    <label class="crop-axis"><span>X</span><input data-folio-control="x" type="range" min="0" max="100" step="5"></label>
    <label class="crop-axis"><span>Y</span><input data-folio-control="y" type="range" min="0" max="100" step="5"></label>
  </div>`;
}

function refreshFigure(figure: HTMLElement): void {
  const image = figure.querySelector<HTMLImageElement>("img[data-folio-asset]");
  if (!image) return;
  const scale = clamp(figure.dataset.folioScale, 25, 100, 100);
  const crop = figure.dataset.folioCrop === "true";
  const ratio = figure.dataset.folioRatio || "4-3";
  const x = clamp(figure.dataset.folioX, 0, 100, 50);
  const y = clamp(figure.dataset.folioY, 0, 100, 50);
  const wrap = wrapMode(figure);

  figure.dataset.folioScale = String(scale);
  figure.dataset.folioCrop = String(crop);
  figure.dataset.folioRatio = ratio;
  figure.dataset.folioX = String(x);
  figure.dataset.folioY = String(y);
  figure.dataset.folioWrap = wrap;
  figure.style.width = `${scale}%`;
  figure.style.float = wrap === "none" ? "none" : wrap;
  figure.style.margin = wrap === "left"
    ? ".25em 1.05em .75em 0"
    : wrap === "right"
      ? ".25em 0 .75em 1.05em"
      : "1em auto";

  figure.classList.toggle("wrap-left", wrap === "left");
  figure.classList.toggle("wrap-right", wrap === "right");
  figure.classList.toggle("wrap-none", wrap === "none");

  image.style.width = "100%";
  image.style.height = "auto";
  image.style.aspectRatio = crop ? ratioCss(ratio) : "auto";
  image.style.objectFit = crop ? "cover" : "contain";
  image.style.objectPosition = crop ? `${x}% ${y}%` : "50% 50%";

  const scaleInput = figure.querySelector<HTMLInputElement>('[data-folio-control="scale"]');
  const wrapInput = figure.querySelector<HTMLSelectElement>('[data-folio-control="wrap"]');
  const ratioInput = figure.querySelector<HTMLSelectElement>('[data-folio-control="ratio"]');
  const xInput = figure.querySelector<HTMLInputElement>('[data-folio-control="x"]');
  const yInput = figure.querySelector<HTMLInputElement>('[data-folio-control="y"]');
  const cropButton = figure.querySelector<HTMLButtonElement>('[data-folio-control="crop"]');
  if (scaleInput) scaleInput.value = String(scale);
  if (wrapInput) wrapInput.value = wrap;
  if (ratioInput) { ratioInput.value = ratio; ratioInput.disabled = !crop; }
  if (xInput) { xInput.value = String(x); xInput.disabled = !crop; }
  if (yInput) { yInput.value = String(y); yInput.disabled = !crop; }
  if (cropButton) {
    const label = crop ? "Crop on" : "Crop";
    if (cropButton.textContent !== label) cropButton.textContent = label;
    if (cropButton.getAttribute("aria-pressed") !== String(crop)) cropButton.setAttribute("aria-pressed", String(crop));
  }
}

function hydrateFigure(figure: HTMLElement): void {
  if (!figure.dataset.folioScale) figure.dataset.folioScale = "100";
  if (!figure.dataset.folioCrop) figure.dataset.folioCrop = "false";
  if (!figure.dataset.folioRatio) figure.dataset.folioRatio = "4-3";
  if (!figure.dataset.folioX) figure.dataset.folioX = "50";
  if (!figure.dataset.folioY) figure.dataset.folioY = "50";
  if (!figure.dataset.folioWrap) figure.dataset.folioWrap = "none";
  if (!figure.querySelector(".editor-illustration-controls")) {
    figure.insertAdjacentHTML("beforeend", controlsMarkup());
  }
  refreshFigure(figure);
}

function hydrateAll(): void {
  document.querySelectorAll<HTMLElement>(".rich-editor .editor-illustration").forEach(hydrateFigure);
}

function markDirty(figure: HTMLElement): void {
  refreshFigure(figure);
  const editor = figure.closest<HTMLElement>(".rich-editor");
  editor?.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "formatSetBlockTextDirection" }));
}

function updateFromControl(control: HTMLElement, figure: HTMLElement): void {
  const kind = control.dataset.folioControl;
  if (kind === "scale" && control instanceof HTMLInputElement) figure.dataset.folioScale = String(clamp(control.value, 25, 100, 100));
  if (kind === "wrap" && control instanceof HTMLSelectElement) figure.dataset.folioWrap = control.value === "left" ? "left" : control.value === "right" ? "right" : "none";
  if (kind === "ratio" && control instanceof HTMLSelectElement) figure.dataset.folioRatio = control.value || "4-3";
  if (kind === "x" && control instanceof HTMLInputElement) figure.dataset.folioX = String(clamp(control.value, 0, 100, 50));
  if (kind === "y" && control instanceof HTMLInputElement) figure.dataset.folioY = String(clamp(control.value, 0, 100, 50));
  markDirty(figure);
}

type DragState = {
  figure: HTMLElement;
  editor: HTMLElement;
  pointerId: number;
};

let dragState: DragState | null = null;

function topLevelAnchor(editor: HTMLElement, y: number, figure: HTMLElement): Element | null {
  const candidates = Array.from(editor.children).filter((child) => child !== figure);
  for (const child of candidates) {
    const rect = child.getBoundingClientRect();
    if (y < rect.top + rect.height / 2) return child;
  }
  return null;
}

function updateDrag(clientX: number, clientY: number): void {
  if (!dragState) return;
  const { figure, editor } = dragState;
  const editorRect = editor.getBoundingClientRect();
  if (clientY < editorRect.top - 60 || clientY > editorRect.bottom + 60) return;

  const anchor = topLevelAnchor(editor, clientY, figure);
  if (anchor) editor.insertBefore(figure, anchor);
  else editor.appendChild(figure);

  const xRatio = (clientX - editorRect.left) / Math.max(1, editorRect.width);
  figure.dataset.folioWrap = xRatio < 0.43 ? "left" : xRatio > 0.57 ? "right" : "none";
  refreshFigure(figure);
}

export function installIllustrationControls(): void {
  const observer = new MutationObserver(hydrateAll);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  requestAnimationFrame(hydrateAll);

  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const control = target?.closest<HTMLElement>('[data-folio-control="crop"]');
    const figure = control?.closest<HTMLElement>(".editor-illustration");
    if (!control || !figure) return;
    event.preventDefault();
    figure.dataset.folioCrop = figure.dataset.folioCrop === "true" ? "false" : "true";
    markDirty(figure);
  }, true);

  const onValue = (event: Event) => {
    const control = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-folio-control]");
    const figure = control?.closest<HTMLElement>(".editor-illustration");
    if (!control || !figure || control.dataset.folioControl === "crop" || control.dataset.folioControl === "drag") return;
    updateFromControl(control, figure);
  };
  document.addEventListener("input", onValue, true);
  document.addEventListener("change", onValue, true);

  document.addEventListener("pointerdown", (event) => {
    const target = event.target as HTMLElement | null;
    const handle = target?.closest<HTMLElement>('[data-folio-control="drag"]');
    const figure = handle?.closest<HTMLElement>(".editor-illustration");
    const editor = figure?.closest<HTMLElement>(".rich-editor");
    if (!handle || !figure || !editor) return;
    event.preventDefault();
    dragState = { figure, editor, pointerId: event.pointerId };
    figure.classList.add("illustration-dragging");
    handle.setPointerCapture?.(event.pointerId);
  }, true);

  document.addEventListener("pointermove", (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.preventDefault();
    updateDrag(event.clientX, event.clientY);
  }, true);

  const finishDrag = (event: PointerEvent) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const { figure } = dragState;
    dragState = null;
    figure.classList.remove("illustration-dragging");
    markDirty(figure);
  };
  document.addEventListener("pointerup", finishDrag, true);
  document.addEventListener("pointercancel", finishDrag, true);
}
