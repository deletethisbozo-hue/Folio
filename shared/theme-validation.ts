export interface ThemeValidationIssue {
  severity: "error" | "warning";
  field: string;
  message: string;
}

const colors = new Set([
  "paper", "ink", "accent", "headingColor", "subtitleColor", "labelColor",
  "sceneColor", "ruleColor",
]);
const ranges: Record<string, [number, number]> = {
  bodySize: [.72, 1.5],
  lineHeight: [1.2, 2.1],
  paragraphIndent: [0, 4],
  paragraphSpacing: [0, 3],
  headingSize: [.8, 4.5],
  headingTracking: [-.08, .5],
  headingTop: [0, 8],
  headingBottom: [.1, 8],
  subtitleSize: [.5, 2],
  subtitleTracking: [-.05, .5],
  labelSize: [.24, 1.2],
  labelTracking: [0, .7],
  sceneSize: [.5, 3],
  ruleWidth: [.5, 8],
  ruleLength: [35, 100],
  rulePadding: [0, 3],
  ruleRadius: [0, 40],
  titlePageSize: [1, 5],
};
const enums: Record<string, readonly string[]> = {
  bodyAlign: ["left", "justify"],
  headingAlign: ["left", "center", "right"],
  headingCase: ["normal", "smallcaps", "uppercase"],
  headingStyle: ["normal", "italic"],
  subtitleAlign: ["left", "center", "right"],
  subtitleStyle: ["normal", "italic"],
  dropcapSize: ["small", "large"],
  chapterRule: ["none", "top", "bottom", "top-bottom", "left", "right", "box", "double", "dashed", "dotted", "shadow", "corners"],
  titlePageAlign: ["left", "center", "right"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validateThemeConfig(
  config: unknown,
  options: { baseTheme?: string; knownBaseThemes?: readonly string[]; installedFonts?: readonly string[] } = {},
): ThemeValidationIssue[] {
  const issues: ThemeValidationIssue[] = [];
  if (!isRecord(config)) return [{ severity: "error", field: "config", message: "Theme settings must be an object." }];

  if (options.baseTheme && options.knownBaseThemes && !options.knownBaseThemes.includes(options.baseTheme)) {
    issues.push({ severity: "error", field: "baseTheme", message: "Choose an available Folio base theme." });
  }

  for (const [field, value] of Object.entries(config)) {
    if (field === "name" && value !== undefined && (typeof value !== "string" || !value.trim() || value.length > 64)) {
      issues.push({ severity: "error", field, message: "Theme name must contain 1 to 64 characters." });
    }
    if (["enabled", "labelVisible", "dropcap"].includes(field) && value !== undefined && typeof value !== "boolean") {
      issues.push({ severity: "error", field, message: `${field} must be true or false.` });
    }
    if (colors.has(field) && value !== undefined && (typeof value !== "string" || !/^#[\da-f]{3}(?:[\da-f]{3})?(?:[\da-f]{2})?$/i.test(value))) {
      issues.push({ severity: "error", field, message: `${field} must be a 3, 6, or 8 digit hex color.` });
    }
    const range = ranges[field];
    if (range && value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < range[0] || value > range[1])) {
      issues.push({ severity: "error", field, message: `${field} must be between ${range[0]} and ${range[1]}.` });
    }
    const allowed = enums[field];
    if (allowed && value !== undefined && (typeof value !== "string" || !allowed.includes(value))) {
      issues.push({ severity: "error", field, message: `${field} has an unsupported value.` });
    }
    if (["bodyFont", "headingFont", "dropcapFont", "titlePageFont"].includes(field) && value !== undefined) {
      if (typeof value !== "string" || !value.trim() || value.length > 180 || /[{};<>\r\n]/.test(value)) {
        issues.push({ severity: "error", field, message: `${field} must be a valid font family name.` });
      } else if (options.installedFonts && !options.installedFonts.includes(value.trim())) {
        issues.push({ severity: "warning", field, message: `${value.trim()} is not in Folio's portable font library; some readers may substitute another font.` });
      }
    }
  }

  const artRanges: Array<[string, number, number]> = [
    ["chapterOrnament", 6, 100],
    ["sceneImage", 4, 80],
  ];
  for (const [slot, minWidth, maxWidth] of artRanges) {
    const image = config[slot];
    if (image === undefined) continue;
    if (!isRecord(image)) {
      issues.push({ severity: "error", field: slot, message: `${slot} settings must be an object.` });
      continue;
    }
    const dataUrl = image.dataUrl;
    if (dataUrl !== undefined && (typeof dataUrl !== "string" || dataUrl.length > 18_000_000 || !/^data:image\/(?:png|jpeg|webp|svg\+xml);base64,[a-z0-9+/=\r\n]+$/i.test(dataUrl))) {
      issues.push({ severity: "error", field: `${slot}.dataUrl`, message: "Artwork must be an embedded PNG, JPEG, WebP, or SVG image under 12 MB." });
    }
    for (const [field, min, max] of [
      ["width", minWidth, maxWidth],
      ["height", .6, 12],
      ["gap", 0, slot === "chapterOrnament" ? 5 : 6],
      ["opacity", .1, 1],
      ["offsetX", -100, 100],
      ["offsetY", -60, 60],
    ] as const) {
      const value = image[field];
      if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)) {
        issues.push({ severity: "error", field: `${slot}.${field}`, message: `${field} must be between ${min} and ${max}.` });
      }
    }
    if (image.placement !== undefined && !["above", "below"].includes(String(image.placement))) {
      issues.push({ severity: "error", field: `${slot}.placement`, message: "Artwork placement must be above or below." });
    }
    if (image.align !== undefined && !["left", "center", "right"].includes(String(image.align))) {
      issues.push({ severity: "error", field: `${slot}.align`, message: "Artwork alignment is not supported." });
    }
  }

  for (const field of ["labelText", "sceneOrnament"] as const) {
    const value = config[field];
    if (value !== undefined && (typeof value !== "string" || value.length > 48)) {
      issues.push({ severity: "error", field, message: `${field} must contain no more than 48 characters.` });
    }
  }

  const paper = typeof config.paper === "string" ? config.paper : "#ffffff";
  const ink = typeof config.ink === "string" ? config.ink : "#000000";
  if (/^#[\da-f]{6}$/i.test(paper) && /^#[\da-f]{6}$/i.test(ink)) {
    const luminance = (hex: string) => {
      const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
        .map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
      return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
    };
    const [light, dark] = [luminance(paper), luminance(ink)].sort((a, b) => b - a);
    if ((light + .05) / (dark + .05) < 4.5) {
      issues.push({ severity: "warning", field: "ink", message: "Body text contrast is below the recommended 4.5:1 reading threshold." });
    }
  }
  return issues;
}
