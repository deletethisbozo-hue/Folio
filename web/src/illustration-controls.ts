function clamp(value: string | undefined, min: number, max: number, fallback: number): number {
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

function controlsMarkup(): string {
  return `<div class="editor-illustration-controls" contenteditable="false">
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

  figure.dataset.folioScale = String(scale);
  figure.dataset.folioCrop = String(crop);
  figure.dataset.folioRatio = ratio;
  figure.dataset.folioX = String(x);
  figure.dataset.folioY = String(y);
  figure.style.width = `${scale}%`;

  image.style.width = "100%";
  image.style.height = "auto";
  image.style.aspectRatio = crop ? ratioCss(ratio) : "auto";
  image.style.objectFit = crop ? "cover" : "contain";
  image.style.objectPosition = crop ? `${x}% ${y}%` : "50% 50%";

  const scaleInput = figure.querySelector<HTMLInputElement>('[data-folio-control="scale"]');
  const ratioInput = figure.querySelector<HTMLSelectElement>('[data-folio-control="ratio"]');
  const xInput = figure.querySelector<HTMLInputElement>('[data-folio-control="x"]');
  const yInput = figure.querySelector<HTMLInputElement>('[data-folio-control="y"]');
  const cropButton = figure.querySelector<HTMLButtonElement>('[data-folio-control="crop"]');
  if (scaleInput) scaleInput.value = String(scale);
  if (ratioInput) { ratioInput.value = ratio; ratioInput.disabled = !crop; }
  if (xInput) { xInput.value = String(x); xInput.disabled = !crop; }
  if (yInput) { yInput.value = String(y); yInput.disabled = !crop; }
  if (cropButton) {
    // MutationObserver watches child-list changes. Assigning textContent on every
    // hydration creates a self-triggering microtask loop that can freeze the UI
    // immediately after an illustration is inserted. Keep DOM writes idempotent.
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
  if (kind === "ratio" && control instanceof HTMLSelectElement) figure.dataset.folioRatio = control.value || "4-3";
  if (kind === "x" && control instanceof HTMLInputElement) figure.dataset.folioX = String(clamp(control.value, 0, 100, 50));
  if (kind === "y" && control instanceof HTMLInputElement) figure.dataset.folioY = String(clamp(control.value, 0, 100, 50));
  markDirty(figure);
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
    if (!control || !figure || control.dataset.folioControl === "crop") return;
    updateFromControl(control, figure);
  };
  document.addEventListener("input", onValue, true);
  document.addEventListener("change", onValue, true);
}
