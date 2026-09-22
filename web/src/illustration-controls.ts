import { applySafeContourToFigure } from "./contour-wrap";

type WrapMode = "none" | "left" | "right";
type ShapeMode = "box" | "contour";

type DragState = {
  kind: "move";
  figure: HTMLElement;
  editor: HTMLElement;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
};

type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

type ResizeState = {
  kind: "resize";
  figure: HTMLElement;
  editor: HTMLElement;
  pointerId: number;
  handle: ResizeHandle;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  startScale: number;
};

type InteractionState = DragState | ResizeState;

let interaction: InteractionState | null = null;
let selectedFigure: HTMLElement | null = null;
let selectedAsset: string | null = null;
let pendingDirtyFrame = 0;

function clamp(value: string | number | undefined, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function ratioCss(value: string): string {
  if (value === "1-1") return "1 / 1";
  if (value === "3-2") return "3 / 2";
  if (value === "2-3") return "2 / 3";
  if (value === "16-9") return "16 / 9";
  return "4 / 3";
}

function wrapMode(figure: HTMLElement): WrapMode {
  if (figure.dataset.folioWrap === "left") return "left";
  if (figure.dataset.folioWrap === "right") return "right";
  return "none";
}

function shapeMode(figure: HTMLElement): ShapeMode {
  return figure.dataset.folioShape === "contour" ? "contour" : "box";
}

function inspectorMarkup(): string {
  return `<div class="editor-illustration-controls folio-image-inspector" contenteditable="false" role="toolbar" aria-label="Illustration">
    <div class="folio-wrap-group" role="group" aria-label="Text wrap">
      <button type="button" data-folio-wrap-choice="left" title="Wrap text on the right">Left</button>
      <button type="button" data-folio-wrap-choice="none" title="Center without text wrap">Center</button>
      <button type="button" data-folio-wrap-choice="right" title="Wrap text on the left">Right</button>
    </div>
    <label class="folio-size-slider" title="Illustration width"><span>Size</span><input data-folio-control="scale" type="range" min="25" max="100" step="1"></label>
    <div class="folio-shape-group" role="group" aria-label="Wrap shape">
      <button type="button" data-folio-shape-choice="box" title="Wrap around the image rectangle">Box</button>
      <button type="button" data-folio-shape-choice="contour" title="Wrap around transparent PNG pixels">Contour</button>
    </div>
    <label class="folio-gap-slider" title="Distance between text and illustration contour"><span>Gap</span><input data-folio-control="gap" type="range" min="25" max="200" step="5"></label>
    <button type="button" data-folio-control="crop" aria-pressed="false">Crop</button>
    <select data-folio-control="ratio" aria-label="Crop ratio">
      <option value="1-1">1:1</option>
      <option value="4-3">4:3</option>
      <option value="3-2">3:2</option>
      <option value="2-3">2:3</option>
      <option value="16-9">16:9</option>
    </select>
    <label class="crop-axis" title="Crop horizontal focus"><span>X</span><input data-folio-control="x" type="range" min="0" max="100" step="5"></label>
    <label class="crop-axis" title="Crop vertical focus"><span>Y</span><input data-folio-control="y" type="range" min="0" max="100" step="5"></label>
    <span class="folio-image-size" aria-live="polite"></span>
  </div>`;
}

function selectFigure(figure: HTMLElement | null): void {
  if (selectedFigure === figure) {
    if (figure) selectedAsset = figure.querySelector<HTMLImageElement>("img[data-folio-asset]")?.dataset.folioAsset ?? selectedAsset;
    return;
  }
  selectedFigure?.classList.remove("folio-image-selected");
  selectedFigure = figure;
  selectedAsset = figure?.querySelector<HTMLImageElement>("img[data-folio-asset]")?.dataset.folioAsset ?? null;
  selectedFigure?.classList.add("folio-image-selected");
}

function applyWrapLayout(figure: HTMLElement, image: HTMLImageElement): void {
  const wrap = wrapMode(figure);
  const shape = shapeMode(figure);
  const gap = clamp(figure.dataset.folioGap, 25, 200, 65);
  const crop = figure.dataset.folioCrop === "true";
  figure.classList.toggle("folio-wrap-left", wrap === "left");
  figure.classList.toggle("folio-wrap-right", wrap === "right");
  figure.classList.toggle("folio-wrap-none", wrap === "none");
  figure.classList.toggle("folio-shape-contour", shape === "contour");
  figure.style.float = wrap === "none" ? "none" : wrap;

  /* V4 never trusts browser alpha wrapping directly. Until the safety polygon
   * is ready, keep a conservative rectangle. The async contour pass then
   * replaces it with a dilated polygon that cannot touch visible artwork. */
  const useContour = wrap !== "none" && shape === "contour" && !crop;
  if (useContour) {
    figure.style.margin = wrap === "left" ? "0.16em 0 .72em 0" : "0.16em 0 .72em 0";
    figure.style.setProperty("shape-outside", "inset(0)");
    figure.style.setProperty("shape-margin", "0px");
    figure.style.removeProperty("shape-image-threshold");
    void applySafeContourToFigure(figure, image);
  } else {
    figure.style.removeProperty("shape-outside");
    figure.style.removeProperty("shape-image-threshold");
    figure.style.removeProperty("shape-margin");
    delete figure.dataset.folioContourReady;
    if (wrap === "left") figure.style.margin = "0.22em 1.05em .8em 0";
    else if (wrap === "right") figure.style.margin = "0.22em 0 .8em 1.05em";
    else figure.style.margin = "1em auto";
  }
}

function refreshFigure(figure: HTMLElement): void {
  const image = figure.querySelector<HTMLImageElement>("img[data-folio-asset]");
  if (!image) return;

  const scale = clamp(figure.dataset.folioScale, 18, 100, 42);
  const crop = figure.dataset.folioCrop === "true";
  const ratio = figure.dataset.folioRatio || "4-3";
  const x = clamp(figure.dataset.folioX, 0, 100, 50);
  const y = clamp(figure.dataset.folioY, 0, 100, 50);
  const wrap = wrapMode(figure);
  const shape = shapeMode(figure);
  const gap = clamp(figure.dataset.folioGap, 0, 150, 65);

  figure.dataset.folioScale = String(Math.round(scale));
  figure.dataset.folioCrop = String(crop);
  figure.dataset.folioRatio = ratio;
  figure.dataset.folioX = String(Math.round(x));
  figure.dataset.folioY = String(Math.round(y));
  figure.dataset.folioWrap = wrap;
  figure.dataset.folioShape = shape;
  figure.dataset.folioGap = String(Math.round(gap));
  figure.style.width = `${scale}%`;
  applyWrapLayout(figure, image);

  image.draggable = false;
  image.style.width = "100%";
  image.style.height = "auto";
  image.style.aspectRatio = crop ? ratioCss(ratio) : "auto";
  image.style.objectFit = crop ? "cover" : "contain";
  image.style.objectPosition = crop ? `${x}% ${y}%` : "50% 50%";

  figure.querySelectorAll<HTMLButtonElement>("[data-folio-wrap-choice]").forEach((button) => {
    const active = button.dataset.folioWrapChoice === wrap;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  figure.querySelectorAll<HTMLButtonElement>("[data-folio-shape-choice]").forEach((button) => {
    const active = button.dataset.folioShapeChoice === shape;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    button.disabled = crop && button.dataset.folioShapeChoice === "contour";
  });

  const scaleInput = figure.querySelector<HTMLInputElement>('[data-folio-control="scale"]');
  const gapInput = figure.querySelector<HTMLInputElement>('[data-folio-control="gap"]');
  const ratioInput = figure.querySelector<HTMLSelectElement>('[data-folio-control="ratio"]');
  const xInput = figure.querySelector<HTMLInputElement>('[data-folio-control="x"]');
  const yInput = figure.querySelector<HTMLInputElement>('[data-folio-control="y"]');
  const cropButton = figure.querySelector<HTMLButtonElement>('[data-folio-control="crop"]');
  const size = figure.querySelector<HTMLElement>(".folio-image-size");

  if (scaleInput) scaleInput.value = String(Math.round(scale));
  if (gapInput) {
    gapInput.value = String(Math.round(gap));
    gapInput.disabled = wrap === "none" || shape !== "contour" || crop;
  }
  if (ratioInput) {
    ratioInput.value = ratio;
    ratioInput.disabled = !crop;
  }
  if (xInput) {
    xInput.value = String(Math.round(x));
    xInput.disabled = !crop;
  }
  if (yInput) {
    yInput.value = String(Math.round(y));
    yInput.disabled = !crop;
  }
  if (cropButton) {
    cropButton.setAttribute("aria-pressed", String(crop));
    cropButton.classList.toggle("active", crop);
  }
  if (size) { const label = `${Math.round(scale)}%`; if (size.textContent !== label) size.textContent = label; }
}

function hydrateFigure(figure: HTMLElement): void {
  if (!figure.dataset.folioScale) figure.dataset.folioScale = "42";
  if (!figure.dataset.folioCrop) figure.dataset.folioCrop = "false";
  if (!figure.dataset.folioRatio) figure.dataset.folioRatio = "4-3";
  if (!figure.dataset.folioX) figure.dataset.folioX = "50";
  if (!figure.dataset.folioY) figure.dataset.folioY = "50";
  if (!figure.dataset.folioWrap) figure.dataset.folioWrap = "right";
  if (!figure.dataset.folioShape) figure.dataset.folioShape = "box";
  if (!figure.dataset.folioGap) figure.dataset.folioGap = "65";

  let controls = figure.querySelector<HTMLElement>(".editor-illustration-controls");
  if (!controls) {
    figure.insertAdjacentHTML("beforeend", inspectorMarkup());
    controls = figure.querySelector<HTMLElement>(".editor-illustration-controls");
  } else if (!controls.classList.contains("folio-image-inspector")) {
    controls.outerHTML = inspectorMarkup();
  }

  if (!figure.querySelector(".folio-image-resize")) {
    const handles: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
    for (const handleName of handles) {
      const resize = document.createElement("button");
      resize.type = "button";
      resize.className = `folio-image-resize folio-image-resize-${handleName}`;
      resize.dataset.folioResize = handleName;
      resize.setAttribute("aria-label", `Resize illustration ${handleName}`);
      resize.title = "Drag to resize";
      resize.contentEditable = "false";
      figure.appendChild(resize);
    }
  }

  figure.setAttribute("tabindex", "0");
  refreshFigure(figure);

  // React can replace the entire editable figure after a DOM -> Markdown ->
  // DOM round-trip. Preserve selection by the stable project asset so resize
  // handles do not disappear under the user's pointer.
  const asset = figure.querySelector<HTMLImageElement>("img[data-folio-asset]")?.dataset.folioAsset ?? null;
  if (selectedAsset && asset === selectedAsset && selectedFigure !== figure) {
    if (!selectedFigure?.isConnected || selectedFigure.dataset.folioIllustration === "true") {
      selectedFigure?.classList.remove("folio-image-selected");
      selectedFigure = figure;
      figure.classList.add("folio-image-selected");
    }
  }
}

function hydrateAll(): void {
  document.querySelectorAll<HTMLElement>(".rich-editor .editor-illustration").forEach(hydrateFigure);
}

function dispatchDirty(figure: HTMLElement, immediate = false): void {
  const editor = figure.closest<HTMLElement>(".rich-editor");
  if (!editor) return;
  const fire = () => {
    pendingDirtyFrame = 0;
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText" }));
  };
  if (immediate) {
    if (pendingDirtyFrame) cancelAnimationFrame(pendingDirtyFrame);
    fire();
    return;
  }
  if (!pendingDirtyFrame) pendingDirtyFrame = requestAnimationFrame(fire);
}

function setWrap(figure: HTMLElement, wrap: WrapMode, dirty = true): void {
  figure.dataset.folioWrap = wrap;
  refreshFigure(figure);
  if (dirty) dispatchDirty(figure);
}

function updateControl(control: HTMLElement, figure: HTMLElement): void {
  const kind = control.dataset.folioControl;
  if (kind === "scale" && control instanceof HTMLInputElement) figure.dataset.folioScale = String(clamp(control.value, 25, 100, 42));
  if (kind === "gap" && control instanceof HTMLInputElement) figure.dataset.folioGap = String(clamp(control.value, 25, 200, 65));
  if (kind === "ratio" && control instanceof HTMLSelectElement) figure.dataset.folioRatio = control.value || "4-3";
  if (kind === "x" && control instanceof HTMLInputElement) figure.dataset.folioX = String(clamp(control.value, 0, 100, 50));
  if (kind === "y" && control instanceof HTMLInputElement) figure.dataset.folioY = String(clamp(control.value, 0, 100, 50));
  refreshFigure(figure);
  dispatchDirty(figure);
}

function topLevelBlocks(editor: HTMLElement, figure: HTMLElement): HTMLElement[] {
  return Array.from(editor.children)
    .filter((node): node is HTMLElement => node instanceof HTMLElement && node !== figure && !node.classList.contains("folio-drag-placeholder"));
}

function reanchorAtPointer(editor: HTMLElement, figure: HTMLElement, clientY: number): void {
  const blocks = topLevelBlocks(editor, figure);
  let target: HTMLElement | null = null;
  let after = false;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const block of blocks) {
    const rect = block.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    const distance = Math.abs(clientY - mid);
    if (distance < bestDistance) {
      bestDistance = distance;
      target = block;
      after = clientY >= mid;
    }
  }

  if (!target) {
    editor.appendChild(figure);
    return;
  }
  if (after) target.insertAdjacentElement("afterend", figure);
  else editor.insertBefore(figure, target);
}

function wrapFromPointer(editor: HTMLElement, clientX: number): WrapMode {
  const rect = editor.getBoundingClientRect();
  const t = (clientX - rect.left) / Math.max(1, rect.width);
  if (t < 0.44) return "left";
  if (t > 0.56) return "right";
  return "none";
}

function beginMove(event: PointerEvent, figure: HTMLElement, editor: HTMLElement): void {
  selectFigure(figure);
  interaction = {
    kind: "move",
    figure,
    editor,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
  };
  figure.setPointerCapture?.(event.pointerId);
}

function moveIllustration(event: PointerEvent, state: DragState): void {
  const distance = Math.hypot(event.clientX - state.startX, event.clientY - state.startY);
  if (!state.moved && distance < 4) return;
  state.moved = true;
  state.figure.classList.add("folio-image-dragging");

  reanchorAtPointer(state.editor, state.figure, event.clientY);
  setWrap(state.figure, wrapFromPointer(state.editor, event.clientX), false);
  dispatchDirty(state.figure);
}

function resizeIllustration(event: PointerEvent, state: ResizeState): void {
  const editorRect = state.editor.getBoundingClientRect();
  const wrap = wrapMode(state.figure);
  const dx = event.clientX - state.startX;
  const dy = event.clientY - state.startY;
  const aspect = Math.max(0.05, state.startWidth / Math.max(1, state.startHeight));
  const horizontalDirection = state.handle.includes("w") ? -1 : state.handle.includes("e") ? 1 : 0;
  const verticalDirection = state.handle.includes("n") ? -1 : state.handle.includes("s") ? 1 : 0;

  const widthFromX = horizontalDirection
    ? state.startWidth + dx * horizontalDirection
    : state.startWidth;
  const widthFromY = verticalDirection
    ? state.startWidth + dy * verticalDirection * aspect
    : state.startWidth;

  let widthPx = state.startWidth;
  if (horizontalDirection && verticalDirection) {
    // Corners preserve the image's intrinsic proportions and use whichever
    // pointer axis represents the stronger intentional resize.
    const xDelta = Math.abs(widthFromX - state.startWidth);
    const yDelta = Math.abs(widthFromY - state.startWidth);
    widthPx = xDelta >= yDelta ? widthFromX : widthFromY;
  } else if (horizontalDirection) {
    widthPx = widthFromX;
  } else if (verticalDirection) {
    widthPx = widthFromY;
  }

  const maxPercent = wrap === "none" ? 100 : 76;
  const percent = clamp((widthPx / Math.max(1, editorRect.width)) * 100, 20, maxPercent, state.startScale);
  state.figure.dataset.folioScale = String(Math.round(percent * 10) / 10);
  refreshFigure(state.figure);
  dispatchDirty(state.figure);
}

function finishInteraction(event: PointerEvent): void {
  if (!interaction || interaction.pointerId !== event.pointerId) return;
  const state = interaction;
  interaction = null;
  state.figure.classList.remove("folio-image-dragging", "folio-image-resizing");
  state.figure.releasePointerCapture?.(event.pointerId);
  dispatchDirty(state.figure, true);
}

export function installIllustrationControls(): void {
  const observer = new MutationObserver(hydrateAll);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  requestAnimationFrame(hydrateAll);

  document.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    const resize = target?.closest<HTMLElement>(".folio-image-resize");
    const figure = target?.closest<HTMLElement>(".editor-illustration");
    const editor = figure?.closest<HTMLElement>(".rich-editor");
    if (!figure || !editor) return;

    if (resize) {
      event.preventDefault();
      event.stopPropagation();
      selectFigure(figure);
      const handle = (resize.dataset.folioResize || "se") as ResizeHandle;
      const rect = figure.getBoundingClientRect();
      interaction = {
        kind: "resize",
        figure,
        editor,
        pointerId: event.pointerId,
        handle,
        startX: event.clientX,
        startY: event.clientY,
        startWidth: rect.width,
        startHeight: rect.height,
        startScale: clamp(figure.dataset.folioScale, 20, 100, 42),
      };
      figure.classList.add("folio-image-resizing");
      figure.setPointerCapture?.(event.pointerId);
      return;
    }

    if (target?.closest(".folio-image-inspector,.editor-illustration-remove")) {
      selectFigure(figure);
      return;
    }

    if (target?.matches("img[data-folio-asset]")) {
      event.preventDefault();
      beginMove(event, figure, editor);
      return;
    }

    selectFigure(figure);
  }, true);

  document.addEventListener("pointermove", (event) => {
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    event.preventDefault();
    if (interaction.kind === "move") moveIllustration(event, interaction);
    else resizeIllustration(event, interaction);
  }, true);

  document.addEventListener("pointerup", finishInteraction, true);
  document.addEventListener("pointercancel", finishInteraction, true);

  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const figure = target?.closest<HTMLElement>(".editor-illustration");

    const wrapButton = target?.closest<HTMLButtonElement>("[data-folio-wrap-choice]");
    if (figure && wrapButton) {
      event.preventDefault();
      event.stopPropagation();
      const mode = wrapButton.dataset.folioWrapChoice;
      setWrap(figure, mode === "left" ? "left" : mode === "right" ? "right" : "none");
      selectFigure(figure);
      return;
    }

    const shapeButton = target?.closest<HTMLButtonElement>("[data-folio-shape-choice]");
    if (figure && shapeButton) {
      event.preventDefault();
      event.stopPropagation();
      if (shapeButton.disabled) return;
      figure.dataset.folioShape = shapeButton.dataset.folioShapeChoice === "contour" ? "contour" : "box";
      refreshFigure(figure);
      dispatchDirty(figure, true);
      selectFigure(figure);
      return;
    }

    const cropButton = target?.closest<HTMLButtonElement>('[data-folio-control="crop"]');
    if (figure && cropButton) {
      event.preventDefault();
      event.stopPropagation();
      figure.dataset.folioCrop = figure.dataset.folioCrop === "true" ? "false" : "true";
      if (figure.dataset.folioCrop === "true" && figure.dataset.folioShape === "contour") figure.dataset.folioShape = "box";
      refreshFigure(figure);
      dispatchDirty(figure, true);
      selectFigure(figure);
      return;
    }

    if (figure) {
      selectFigure(figure);
      return;
    }
    if (!target?.closest(".illustration-button,.illustration-input")) selectFigure(null);
  }, true);

  const onValue = (event: Event) => {
    const control = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-folio-control]");
    const figure = control?.closest<HTMLElement>(".editor-illustration");
    if (!control || !figure || control.dataset.folioControl === "crop") return;
    updateControl(control, figure);
  };
  document.addEventListener("input", onValue, true);
  document.addEventListener("change", onValue, true);

  document.addEventListener("keydown", (event) => {
    if (!selectedFigure || (event.key !== "Delete" && event.key !== "Backspace")) return;
    const target = event.target as HTMLElement | null;
    if (target?.matches("input,textarea,select") || target?.closest("input,textarea,select")) return;
    event.preventDefault();
    const figure = selectedFigure;
    selectFigure(null);
    const editor = figure.closest<HTMLElement>(".rich-editor");
    figure.remove();
    editor?.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
  }, true);
}
