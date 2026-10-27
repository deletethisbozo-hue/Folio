import type { Typography, ThemeLabConfig } from "./types";
import { DROPCAP_FONT_FAMILIES } from "./components/FontPicker";
function safeDropcapFamily(value: string | undefined): string { return value && new Set<string>(DROPCAP_FONT_FAMILIES).has(value) ? value : "Libre Baskerville"; }

export function themeLabTypography(base: Typography, lab: ThemeLabConfig): Typography {
  return {
    ...base,
    themeLab: { ...lab, enabled: true },
    bodyFont: lab.bodyFont,
    fontSize: lab.bodySize ? String(lab.bodySize) + "em" : base.fontSize,
    lineHeight: lab.lineHeight ?? base.lineHeight,
    bodyAlign: lab.bodyAlign ?? base.bodyAlign,
    paragraphIndent: lab.paragraphIndent === undefined ? base.paragraphIndent : String(lab.paragraphIndent) + "em",
    paragraphSpacing: lab.paragraphSpacing === undefined ? base.paragraphSpacing : String(lab.paragraphSpacing) + "em",
    headingFont: lab.headingFont,
    dropcap: lab.dropcap,
    dropcapSize: lab.dropcapSize,
    dropcapFont: safeDropcapFamily(lab.dropcapFont ?? lab.headingFont),
    sceneOrnament: lab.sceneOrnament,
    titlePageFont: lab.titlePageFont,
    chapterTitle: {
      ...base.chapterTitle,
      size: lab.headingSize ? String(lab.headingSize) + "em" : base.chapterTitle?.size,
      case: lab.headingCase ?? base.chapterTitle?.case,
      align: lab.headingAlign ?? base.chapterTitle?.align,
      style: lab.headingStyle ?? base.chapterTitle?.style,
      showLabel: lab.labelVisible,
      labelText: lab.labelText,
    },
  };
}

