export type IllustrationContourMode = "safe-box" | "url-fallback";

function clampGap(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(200, parsed)) : 65;
}

function mergeShapeStyle(attrs: string, src: string, gap: number, mode: IllustrationContourMode): string {
  const additions = mode === "url-fallback"
    ? [
        `shape-outside:url(\'${src.replace(/\'/g, "%27")}\')`,
        "shape-image-threshold:.08",
        `shape-margin:${Math.max(.28, gap / 100)}em`,
      ].join(";")
    : "shape-outside:inset(0);shape-margin:0";

  const styleMatch = attrs.match(/\sstyle="([^"]*)"/i);
  if (styleMatch) {
    const cleaned = styleMatch[1]
      .replace(/(?:^|;)\s*shape-outside\s*:[^;]*/gi, "")
      .replace(/(?:^|;)\s*shape-image-threshold\s*:[^;]*/gi, "")
      .replace(/(?:^|;)\s*shape-margin\s*:[^;]*/gi, "")
      .replace(/^;+|;+$/g, "");
    const joined = [cleaned, additions].filter(Boolean).join(";");
    return attrs.replace(styleMatch[0], ` style="${joined}"`);
  }
  return attrs + ` style="${additions}"`;
}

/**
 * Keep semantic contour metadata in HTML while choosing a conservative runtime
 * fallback. Reader/Print replace safe-box with a Folio-computed polygon after
 * the image has loaded. EPUB cannot rely on runtime JS, so it keeps a standards-
 * based URL contour fallback with a non-zero safety margin.
 */
export function applyIllustrationContours(
  html: string,
  mode: IllustrationContourMode = "url-fallback",
): string {
  return html.replace(/<div\b([^>]*)>([\s\S]*?)<\/div>/gi, (whole, attrs: string, inner: string) => {
    const classMatch = attrs.match(/\bclass="([^"]*)"/i);
    const classes = classMatch?.[1] ?? "";
    if (!/\bfolio-illustration-block\b/.test(classes) || !/\bfolio-shape-contour\b/.test(classes)) return whole;
    if (!/\bfolio-wrap-(?:left|right)\b/.test(classes)) return whole;

    const image = inner.match(/<img\b([^>]*)>/i);
    if (!image) return whole;
    const src = image[1].match(/\bsrc="([^"]+)"/i)?.[1];
    if (!src) return whole;

    const gap = clampGap(attrs.match(/\bdata-folio-gap="(\d{1,3})"/i)?.[1]);
    const shapedAttrs = mergeShapeStyle(attrs, src, gap, mode);
    return `<div${shapedAttrs}>${inner}</div>`;
  });
}
