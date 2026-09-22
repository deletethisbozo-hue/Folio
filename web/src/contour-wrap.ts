type WrapSide = "left" | "right";

type AlphaProfile = {
  rows: number;
  left: number[];
  right: number[];
  hasTransparency: boolean;
};

const profileCache = new WeakMap<HTMLImageElement, Promise<AlphaProfile | null>>();
const contourTokens = new WeakMap<HTMLElement, number>();

function numberAttr(value: string | undefined | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function waitForImage(image: HTMLImageElement): Promise<void> {
  if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const loaded = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error("Illustration image failed to load.")); };
    const cleanup = () => {
      image.removeEventListener("load", loaded);
      image.removeEventListener("error", failed);
    };
    image.addEventListener("load", loaded, { once: true });
    image.addEventListener("error", failed, { once: true });
  });
}

async function alphaProfile(image: HTMLImageElement): Promise<AlphaProfile | null> {
  const cached = profileCache.get(image);
  if (cached) return cached;

  const pending = (async () => {
    try {
      await waitForImage(image);
      const naturalWidth = image.naturalWidth;
      const naturalHeight = image.naturalHeight;
      if (!naturalWidth || !naturalHeight) return null;

      // Enough vertical resolution to follow small protrusions (hands, swords,
      // stems) without generating a 1,000-point CSS polygon.
      const rows = Math.max(48, Math.min(160, Math.round(naturalHeight / 4)));
      const columns = Math.max(48, Math.min(220, Math.round(naturalWidth * rows / naturalHeight)));
      const canvas = document.createElement("canvas");
      canvas.width = columns;
      canvas.height = rows;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return null;
      context.clearRect(0, 0, columns, rows);
      context.drawImage(image, 0, 0, columns, rows);
      const pixels = context.getImageData(0, 0, columns, rows).data;

      const left = new Array<number>(rows).fill(1);
      const right = new Array<number>(rows).fill(0);
      let transparent = false;
      let opaque = false;
      // Ignore almost-invisible anti-alias haze. The safety dilation below adds
      // a real clearance around the visible edge anyway.
      const alphaThreshold = 28;

      for (let y = 0; y < rows; y++) {
        let first = columns;
        let last = -1;
        for (let x = 0; x < columns; x++) {
          const alpha = pixels[(y * columns + x) * 4 + 3];
          if (alpha < 250) transparent = true;
          if (alpha >= alphaThreshold) {
            opaque = true;
            if (x < first) first = x;
            if (x > last) last = x;
          }
        }
        if (last >= 0) {
          left[y] = first / Math.max(1, columns - 1);
          right[y] = last / Math.max(1, columns - 1);
        }
      }
      if (!opaque) return null;
      return { rows, left, right, hasTransparency: transparent };
    } catch {
      // Canvas can be tainted by a foreign image in imported HTML. In that case
      // keep the safe rectangular fallback rather than trusting an unsafe shape.
      return null;
    }
  })();

  profileCache.set(image, pending);
  return pending;
}

function sideForFigure(figure: HTMLElement): WrapSide | null {
  const data = figure.dataset.folioWrap;
  if (data === "left" || figure.classList.contains("folio-wrap-left")) return "left";
  if (data === "right" || figure.classList.contains("folio-wrap-right")) return "right";
  return null;
}

function contourGapEm(figure: HTMLElement): number {
  const stored = numberAttr(figure.dataset.folioGap ?? figure.getAttribute("data-folio-gap"), 65);
  // A contour with zero clearance looks broken even when it is mathematically
  // correct. Keep a non-negotiable safety halo of 0.28em.
  return Math.max(0.28, Math.min(2, stored / 100));
}

function polygonFor(
  profile: AlphaProfile,
  side: WrapSide,
  widthPx: number,
  heightPx: number,
  gapPx: number,
): string | null {
  if (widthPx < 2 || heightPx < 2) return null;
  const sampleCount = Math.max(24, Math.min(64, Math.round(heightPx / 10)));
  const points: string[] = [];
  const rows = profile.rows;

  for (let i = 0; i < sampleCount; i++) {
    const yFraction = sampleCount === 1 ? 0 : i / (sampleCount - 1);
    const sourceY = yFraction * (rows - 1);
    const verticalRadiusRows = Math.ceil(gapPx / heightPx * rows);
    let boundaryPx = side === "left" ? 0 : widthPx;

    const from = Math.max(0, Math.floor(sourceY) - verticalRadiusRows);
    const to = Math.min(rows - 1, Math.ceil(sourceY) + verticalRadiusRows);
    let found = false;

    for (let row = from; row <= to; row++) {
      const fraction = side === "left" ? profile.right[row] : profile.left[row];
      const rowHasInk = side === "left" ? fraction > 0 : fraction < 1;
      if (!rowHasInk) continue;
      found = true;

      const rowY = row / Math.max(1, rows - 1) * heightPx;
      const targetY = yFraction * heightPx;
      const dy = Math.abs(rowY - targetY);
      if (dy > gapPx + 0.5) continue;
      const radialX = Math.sqrt(Math.max(0, gapPx * gapPx - dy * dy));
      const inkX = fraction * widthPx;
      const safeX = side === "left" ? inkX + radialX : inkX - radialX;
      boundaryPx = side === "left"
        ? Math.max(boundaryPx, safeX)
        : Math.min(boundaryPx, safeX);
    }

    if (!found) boundaryPx = side === "left" ? 0 : widthPx;
    const xPercent = Math.max(0, Math.min(100, boundaryPx / widthPx * 100));
    const yPercent = yFraction * 100;
    points.push(`${xPercent.toFixed(2)}% ${yPercent.toFixed(2)}%`);
  }

  if (side === "left") {
    return `polygon(0% 0%, ${points.join(", ")}, 0% 100%)`;
  }
  return `polygon(100% 0%, ${points.join(", ")}, 100% 100%)`;
}

function safeBoxFallback(figure: HTMLElement): void {
  figure.style.setProperty("shape-outside", "inset(0)");
  figure.style.setProperty("shape-margin", "0px");
  figure.style.removeProperty("shape-image-threshold");
  figure.dataset.folioContourReady = "false";
}

export async function applySafeContourToFigure(
  figure: HTMLElement,
  image?: HTMLImageElement | null,
): Promise<boolean> {
  const resolvedImage = image ?? figure.querySelector<HTMLImageElement>("img[data-folio-asset],img.folio-illustration,img");
  const side = sideForFigure(figure);
  const contour = figure.dataset.folioShape === "contour" || figure.classList.contains("folio-shape-contour");
  const cropped = figure.dataset.folioCrop === "true" || resolvedImage?.classList.contains("folio-crop");

  if (!resolvedImage || !side || !contour || cropped) {
    figure.style.removeProperty("shape-outside");
    figure.style.removeProperty("shape-image-threshold");
    figure.style.removeProperty("shape-margin");
    delete figure.dataset.folioContourReady;
    return false;
  }

  safeBoxFallback(figure);
  const token = (contourTokens.get(figure) ?? 0) + 1;
  contourTokens.set(figure, token);

  const profile = await alphaProfile(resolvedImage);
  if (!profile || contourTokens.get(figure) !== token || !figure.isConnected) return false;

  const rect = resolvedImage.getBoundingClientRect();
  const figureRect = figure.getBoundingClientRect();
  const widthPx = Math.max(1, rect.width || figureRect.width);
  const heightPx = Math.max(1, rect.height || figureRect.height);
  const fontSize = Number.parseFloat(getComputedStyle(figure).fontSize) || 16;
  const gapPx = contourGapEm(figure) * fontSize;
  const polygon = polygonFor(profile, side, widthPx, heightPx, gapPx);
  if (!polygon) return false;

  figure.style.setProperty("shape-outside", polygon);
  figure.style.setProperty("shape-margin", "0px");
  figure.style.removeProperty("shape-image-threshold");
  figure.dataset.folioContourReady = "true";
  figure.dataset.folioContourPoints = String(Math.max(0, (polygon.match(/%/g)?.length ?? 0) / 2 - 2));
  return true;
}

export async function applySafeContours(root: Document | HTMLElement): Promise<number> {
  const figures = Array.from(root.querySelectorAll<HTMLElement>(
    ".editor-illustration.folio-shape-contour,.folio-illustration-block.folio-shape-contour",
  ));
  const results = await Promise.all(figures.map((figure) => applySafeContourToFigure(figure)));
  return results.filter(Boolean).length;
}
