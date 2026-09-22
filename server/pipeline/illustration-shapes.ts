function clampGap(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(150, parsed)) : 65;
}

function mergeShapeStyle(attrs: string, src: string, gap: number): string {
  const additions = [
    `shape-outside:url('${src.replace(/'/g, "%27")}')`,
    "shape-image-threshold:.08",
    `shape-margin:${gap / 100}em`,
  ].join(";");

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
 * Resolve semantic Folio contour wrapping into browser-consumable CSS.
 *
 * Pandoc correctly embeds or rewrites the <img src>, but it cannot make the
 * float's shape-outside automatically point at that rewritten source. This
 * post-pass uses the actual emitted src, so HTML/Print/PDF and EPUB all wrap
 * against exactly the image readers will display.
 */
export function applyIllustrationContours(html: string): string {
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
    const shapedAttrs = mergeShapeStyle(attrs, src, gap);
    return `<div${shapedAttrs}>${inner}</div>`;
  });
}
