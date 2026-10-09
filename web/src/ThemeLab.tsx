import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import FontPicker from "./components/FontPicker";
import type { BookMeta, Theme, ThemeLabConfig, ThemeLabImage, Typography } from "./types";

type LabPanel = "Foundation" | "Body" | "Chapter" | "Ornaments" | "Title Page";
type ThemePackage = {
  format: "folio-theme";
  version: 1;
  baseTheme: string;
  config: ThemeLabConfig;
};

const panels: LabPanel[] = ["Foundation", "Body", "Chapter", "Ornaments", "Title Page"];

const fontOptions = [
  ["EB Garamond", "EB Garamond"],
  ["Libre Caslon Text", "Libre Caslon Text"],
  ["Libre Baskerville", "Libre Baskerville"],
  ["Newsreader", "Newsreader"],
  ["Gelasio", "Gelasio"],
  ["Vollkorn", "Vollkorn"],
  ["Source Serif 4", "Source Serif 4"],
  ["Source Sans 3", "Source Sans 3"],
  ["Barlow Condensed", "Barlow Condensed"],
  ["Bodoni Moda", "Bodoni Moda"],
  ["Cinzel", "Cinzel"],
  ["Grenze Gotisch", "Grenze Gotisch"],
  ["Roboto Slab", "Roboto Slab"],
  ["Jena Gotisch", "Jena Gotisch"],
  ["Manufacturing Consent", "Manufacturing Consent"],
  ["Kings", "Kings"],
  ["CAT Altenglisch", "CAT Altenglisch"],
  ["Slavkappen", "Slavkappen"],
] as const;

const dropcapFontOptions = [
  ["EB Garamond", "EB Garamond"],
  ["Libre Caslon Text", "Libre Caslon Text"],
  ["Libre Baskerville", "Libre Baskerville"],
  ["Newsreader", "Newsreader"],
  ["Gelasio", "Gelasio"],
  ["Vollkorn", "Vollkorn"],
  ["Source Serif 4", "Source Serif 4"],
  ["Bodoni Moda", "Bodoni Moda"],
  ["Cinzel", "Cinzel"],
  ["Grenze Gotisch", "Grenze Gotisch"],
  ["Roboto Slab", "Roboto Slab"],
] as const;

const safeDropcapFamilies: Set<string> = new Set(dropcapFontOptions.map(([value]) => value));
function safeDropcapFamily(value: string | undefined): string {
  return value && safeDropcapFamilies.has(value) ? value : "Libre Baskerville";
}


// Normalize CSS fallback stacks to the actual bundled family before showing it
// in a single-family picker. Unknown names never masquerade as the first option.
const bundledFamilies = new Set<string>(fontOptions.map(([family]) => family));
function fontFamilyFromStack(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const names = value.match(/"[^"]+"|'[^']+'|[^,]+/g)?.map((piece) => piece.trim().replace(/^["']|["']$/g, "")) ?? [];
  const aliases: Record<string, string> = {
    Georgia: "Gelasio", Garamond: "EB Garamond", Baskerville: "Libre Baskerville",
    "Palatino Linotype": "Vollkorn", "Times New Roman": "Source Serif 4",
  };
  for (const item of names) {
    const resolved = aliases[item] ?? item.replace(/^Folio /, "");
    if (bundledFamilies.has(resolved)) return resolved;
  }
  return fallback;
}

function numberValue(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function selectedTheme(themes: Theme[], name: string): Theme | undefined {
  return themes.find((theme) => theme.name === name) ?? themes[0];
}

function defaultConfig(theme: Theme | undefined, typography: Typography): ThemeLabConfig {
  if (typography.themeLab?.enabled) {
    return {
      ...typography.themeLab,
      bodyFont: fontFamilyFromStack(typography.themeLab.bodyFont, "EB Garamond"),
      headingFont: fontFamilyFromStack(typography.themeLab.headingFont, "Libre Baskerville"),
      titlePageFont: fontFamilyFromStack(typography.themeLab.titlePageFont, "Libre Baskerville"),
      dropcapFont: safeDropcapFamily(typography.themeLab.dropcapFont),
      enabled: true,
    };
  }
  return {
    enabled: true,
    name: "My Theme",
    paper: theme?.previewPaper ?? "#fbfaf6",
    ink: "#242527",
    accent: theme?.previewAccent ?? "#856744",
    bodyFont: fontFamilyFromStack(typography.bodyFont ?? theme?.previewFont, "EB Garamond"),
    bodySize: numberValue(String(typography.fontSize ?? "1").replace("em", ""), 1),
    lineHeight: numberValue(typography.lineHeight, 1.5),
    bodyAlign: typography.bodyAlign ?? "justify",
    paragraphIndent: numberValue(String(typography.paragraphIndent ?? "1.25").replace("em", ""), 1.25),
    paragraphSpacing: numberValue(String(typography.paragraphSpacing ?? "0").replace("em", ""), 0),
    headingFont: fontFamilyFromStack(typography.headingFont ?? theme?.previewHeadingFont, "Libre Baskerville"),
    headingColor: "#242527",
    headingSize: numberValue(String(typography.chapterTitle?.size ?? "1.8").replace("em", ""), 1.8),
    headingWeight: 600,
    headingTracking: 0,
    headingAlign: typography.chapterTitle?.align ?? "center",
    headingCase: typography.chapterTitle?.case ?? "normal",
    headingStyle: typography.chapterTitle?.style ?? "normal",
    headingTop: 1.2,
    headingBottom: 2,
    subtitleSize: .92,
    subtitleAlign: "center",
    subtitleStyle: "italic",
    subtitleTracking: .04,
    subtitleColor: "#665f58",
    labelVisible: typography.chapterTitle?.showLabel ?? true,
    labelText: typography.chapterTitle?.labelText ?? "CHAPTER",
    labelSize: .45,
    labelTracking: .2,
    labelColor: theme?.previewAccent ?? "#856744",
    dropcap: typography.dropcap ?? theme?.dropcap ?? true,
    dropcapSize: typography.dropcapSize ?? "small",
    dropcapFont: safeDropcapFamily(typography.dropcapFont ?? typography.headingFont ?? theme?.previewHeadingFont),
    sceneOrnament: typography.sceneOrnament ?? theme?.sceneOrnament ?? "⁂",
    sceneSize: 1.1,
    sceneColor: theme?.previewAccent ?? "#856744",
    chapterRule: "none",
    ruleWidth: 1,
    ruleColor: theme?.previewAccent ?? "#856744",
    titlePageFont: fontFamilyFromStack(typography.titlePageFont ?? typography.headingFont ?? theme?.previewHeadingFont, "Libre Baskerville"),
    titlePageAlign: "center",
    titlePageSize: 2.4,
  };
}

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

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read image."));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(blob);
  });
}

async function imageFileToSafeDataUrl(file: File): Promise<string> {
  if (file.size > 12 * 1024 * 1024) throw new Error("Image must be 12 MB or smaller.");
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = file.type || (
    extension === "png" ? "image/png" :
    extension === "jpg" || extension === "jpeg" ? "image/jpeg" :
    extension === "webp" ? "image/webp" :
    extension === "svg" ? "image/svg+xml" : ""
  );
  if (!["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(mime)) {
    throw new Error("Use PNG, JPG/JPEG, WebP or SVG.");
  }
  if (mime !== "image/svg+xml") return readBlobAsDataUrl(file);

  const source = await file.text();
  const doc = new DOMParser().parseFromString(source, "image/svg+xml");
  if (doc.querySelector("parsererror") || doc.documentElement.tagName.toLowerCase() !== "svg") {
    throw new Error("That SVG could not be parsed.");
  }
  doc.querySelectorAll("script,foreignObject,iframe,object,embed").forEach((node) => node.remove());
  doc.querySelectorAll("*").forEach((node) => {
    for (const attr of Array.from(node.attributes)) {
      const key = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (key.startsWith("on")) node.removeAttribute(attr.name);
      else if ((key === "href" || key === "xlink:href") && value && !value.startsWith("#")) node.removeAttribute(attr.name);
      else if (key === "style" && /url\s*\(|javascript:|https?:|file:/i.test(value)) node.removeAttribute(attr.name);
    }
  });
  const clean = new XMLSerializer().serializeToString(doc.documentElement);
  return readBlobAsDataUrl(new Blob([clean], { type: "image/svg+xml" }));
}

function slug(value: string): string {
  return (value || "folio-theme").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "folio-theme";
}

function RangeControl(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return <label className="theme-lab-row range-row">
    <span>{props.label}</span>
    <span className="theme-lab-range-control">
      <input type="range" min={props.min} max={props.max} step={props.step} value={props.value} onChange={(event) => props.onChange(Number(event.target.value))}/>
      <output>{props.value}{props.suffix ?? ""}</output>
    </span>
  </label>;
}

function SelectControl(props: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return <label className="theme-lab-row"><span>{props.label}</span><select value={props.value} onChange={(event) => props.onChange(event.target.value)}>{props.children}</select></label>;
}

function ColorControl(props: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="theme-lab-row color-row"><span>{props.label}</span><span className="theme-lab-color"><input type="color" value={props.value} onChange={(event) => props.onChange(event.target.value)}/><input value={props.value} maxLength={9} onChange={(event) => props.onChange(event.target.value)}/></span></label>;
}

function FontControl(props: {label:string; value:string; onChange:(value:string)=>void; options?:readonly (readonly [string,string])[]}) {
  return <div className="theme-lab-row theme-lab-font-row">
    <span>{props.label}</span>
    <FontPicker label={props.label} value={props.value} onChange={props.onChange} families={(props.options ?? fontOptions).map(([value]) => value)}/>
  </div>;
}

function ArtworkControl(props: {
  title: string;
  image?: ThemeLabImage;
  placement?: boolean;
  onChange: (image?: ThemeLabImage) => void;
  onUpload: (file: File) => Promise<void>;
}) {
  const image = props.image;
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = (file?: File) => {
    if (file) void props.onUpload(file);
  };
  return <section className="theme-lab-artwork-card">
    <div className="theme-lab-artwork-head">
      <div><strong>{props.title}</strong><small>PNG, JPG, WebP or SVG · up to 12 MB</small></div>
      {image?.dataUrl && <button type="button" className="theme-lab-button compact danger" onClick={() => props.onChange(undefined)}>Remove</button>}
    </div>
    <button
      type="button"
      className={"theme-lab-artwork-drop" + (image?.dataUrl ? " has-image" : "")}
      onClick={() => inputRef.current?.click()}
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
      onDrop={(event) => {
        event.preventDefault();
        upload(event.dataTransfer.files?.[0]);
      }}
    >
      {image?.dataUrl
        ? <><img src={image.dataUrl} alt="Theme artwork preview"/><span className="theme-lab-artwork-name">{image.name || "Uploaded image"}</span><span className="theme-lab-artwork-action">Click or drop another image to replace</span></>
        : <><span className="theme-lab-artwork-icon">＋</span><strong>Choose image</strong><span>or drag and drop it here</span></>}
    </button>
    <input
      ref={inputRef}
      className="theme-lab-hidden-input"
      type="file"
      accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml"
      onChange={(event) => {
        upload(event.target.files?.[0]);
        event.currentTarget.value = "";
      }}
    />
    {image?.dataUrl && <div className="theme-lab-artwork-controls">
      {props.placement && <SelectControl label="Placement" value={image.placement ?? "below"} onChange={(value) => props.onChange({ ...image, placement: value as "above" | "below" })}><option value="above">Above chapter title</option><option value="below">Below chapter title</option></SelectControl>}
      <RangeControl label="Width" value={image.width ?? 34} min={6} max={100} step={1} suffix="%" onChange={(value) => props.onChange({ ...image, width: value })}/>
      <RangeControl label="Height" value={image.height ?? 3.2} min={.6} max={12} step={.1} suffix="em" onChange={(value) => props.onChange({ ...image, height: value })}/>
      <RangeControl label="Gap to text" value={image.gap ?? .7} min={0} max={6} step={.1} suffix="em" onChange={(value) => props.onChange({ ...image, gap: value })}/>
      <SelectControl label="Horizontal align" value={image.align ?? "center"} onChange={(value) => props.onChange({ ...image, align: value as "left" | "center" | "right" })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></SelectControl>
      <RangeControl label="Move horizontally" value={image.offsetX ?? 0} min={-100} max={100} step={2} suffix="px" onChange={(value) => props.onChange({ ...image, offsetX: value })}/>
      <RangeControl label="Move vertically" value={image.offsetY ?? 0} min={-60} max={60} step={2} suffix="px" onChange={(value) => props.onChange({ ...image, offsetY: value })}/>
      <RangeControl label="Opacity" value={image.opacity ?? 1} min={.1} max={1} step={.05} onChange={(value) => props.onChange({ ...image, opacity: value })}/>
    </div>}
  </section>;
}

export default function ThemeLab(props: {
  themes: Theme[];
  meta: BookMeta;
  typography: Typography;
  projectId: string;
  chapterPreviewId?: string;
  titlePagePreviewId?: string;
  previewDraft?: string;
  onClose: () => void;
  onApply: (meta: BookMeta, typography: Typography) => Promise<void>;
}) {
  const initialTheme = selectedTheme(props.themes, props.meta.theme);
  const [panel, setPanel] = useState<LabPanel>("Foundation");
  const [baseTheme, setBaseTheme] = useState(props.meta.theme);
  const [lab, setLab] = useState<ThemeLabConfig>(() => defaultConfig(initialTheme, props.typography));
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewTarget, setPreviewTarget] = useState<"chapter" | "title">("chapter");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const previewId = previewTarget === "title" && props.titlePagePreviewId ? props.titlePagePreviewId : props.chapterPreviewId;
  const effectiveTypography = useMemo(() => themeLabTypography(props.typography, lab), [props.typography, lab]);
  const effectiveMeta = useMemo(() => ({ ...props.meta, theme: baseTheme }), [props.meta, baseTheme]);

  useEffect(() => {
    if (panel === "Title Page" && props.titlePagePreviewId) setPreviewTarget("title");
    else if (panel !== "Title Page") setPreviewTarget("chapter");
  }, [panel, props.titlePagePreviewId]);

  useEffect(() => {
    if (!previewId) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = window.setTimeout(() => {
      setPreviewLoading(true);
      setPreviewError(null);
      void api.preview(
        props.projectId,
        effectiveMeta,
        baseTheme,
        effectiveTypography,
        previewId,
        previewTarget === "chapter" ? props.previewDraft : undefined,
        controller.signal,
      ).then(({ html }) => {
        if (!controller.signal.aborted) {
          setPreviewHtml(html);
          setPreviewLoading(false);
        }
      }).catch((reason) => {
        if (!controller.signal.aborted) {
          setPreviewError(reason instanceof Error ? reason.message : String(reason));
          setPreviewLoading(false);
        }
      });
    }, 140);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [props.projectId, previewId, props.previewDraft, previewTarget, baseTheme, effectiveMeta, effectiveTypography]);

  useEffect(() => () => abortRef.current?.abort(), []);

  function patch(next: Partial<ThemeLabConfig>) {
    setLab((current) => ({ ...current, ...next, enabled: true }));
  }

  function resetFromBase() {
    setLab(defaultConfig(selectedTheme(props.themes, baseTheme), {}));
  }

  async function uploadArtwork(slot: "chapterOrnament" | "sceneImage", file: File) {
    setError(null);
    try {
      const dataUrl = await imageFileToSafeDataUrl(file);
      const current = lab[slot];
      patch({
        [slot]: {
          dataUrl,
          name: file.name,
          width: current?.width ?? (slot === "chapterOrnament" ? 34 : 18),
          height: current?.height ?? (slot === "chapterOrnament" ? 3.2 : 1.8),
          gap: current?.gap ?? (slot === "chapterOrnament" ? .7 : .2),
          opacity: current?.opacity ?? 1,
          placement: slot === "chapterOrnament" ? current?.placement ?? "below" : undefined,
        },
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  function exportPackage() {
    const payload: ThemePackage = { format: "folio-theme", version: 1, baseTheme, config: { ...lab, enabled: true } };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = slug(lab.name ?? "folio-theme") + ".folio-theme.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function importPackage(file: File) {
    setError(null);
    try {
      if (file.size > 40 * 1024 * 1024) throw new Error("Theme package is unexpectedly large.");
      const parsed = JSON.parse(await file.text()) as Partial<ThemePackage>;
      if (parsed.format !== "folio-theme" || parsed.version !== 1 || !parsed.config || typeof parsed.config !== "object") {
        throw new Error("That is not a Folio Theme Lab package.");
      }
      const theme = props.themes.find((item) => item.name === parsed.baseTheme);
      if (!theme) throw new Error("The package uses a base theme this Folio build does not know.");
      setBaseTheme(theme.name);
      const imported = { ...defaultConfig(theme, {}), ...parsed.config, enabled: true };
      imported.dropcapFont = safeDropcapFamily(imported.dropcapFont);
      imported.bodyFont = fontFamilyFromStack(imported.bodyFont, "EB Garamond");
      imported.headingFont = fontFamilyFromStack(imported.headingFont, "Libre Baskerville");
      imported.titlePageFont = fontFamilyFromStack(imported.titlePageFont, "Libre Baskerville");
      setLab(imported);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      await props.onApply(effectiveMeta, effectiveTypography);
      props.onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  const row = (label: string, control: React.ReactNode) => <label className="theme-lab-row"><span>{label}</span>{control}</label>;
  const alignOptions = <><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></>;

  return <div className="theme-lab-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) props.onClose(); }}>
    <section className="theme-lab-window" role="dialog" aria-modal="true" aria-label="Theme Lab">
      <header className="theme-lab-header">
        <div><span className="theme-lab-eyebrow">Folio 3.1</span><h2>Theme Lab</h2><p>Build a complete book style, preview it on the manuscript, then keep it in the .folio file or export it as a portable theme package.</p></div>
        <div className="theme-lab-header-actions">
          <button type="button" className="theme-lab-button" onClick={() => importRef.current?.click()}>Import Theme</button>
          <input ref={importRef} className="theme-lab-hidden-input" type="file" accept=".json,.folio-theme.json,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importPackage(file); event.currentTarget.value = ""; }}/>
          <button type="button" className="theme-lab-button" onClick={exportPackage}>Export Theme</button>
          <button type="button" className="theme-lab-close" aria-label="Close Theme Lab" disabled={busy} onClick={props.onClose}>×</button>
        </div>
      </header>

      <div className="theme-lab-layout">
        <aside className="theme-lab-nav">
          {panels.map((item) => <button type="button" key={item} className={panel === item ? "active" : ""} onClick={() => setPanel(item)}>{item}</button>)}
          <div className="theme-lab-nav-spacer"/>
          <button type="button" className="theme-lab-reset" onClick={resetFromBase}>Reset from base</button>
        </aside>

        <main className="theme-lab-controls">
          {panel === "Foundation" && <>
            <div className="theme-lab-section-heading"><h3>Foundation</h3><p>Start from a proven Folio theme, then override it deliberately.</p></div>
            {row("Theme name", <input value={lab.name ?? ""} maxLength={64} onChange={(event) => patch({ name: event.target.value })}/>)}
            <SelectControl label="Base theme" value={baseTheme} onChange={setBaseTheme}>{props.themes.map((theme) => <option key={theme.name} value={theme.name}>{theme.label}</option>)}</SelectControl>
            <div className="theme-lab-color-grid">
              <ColorControl label="Paper" value={lab.paper ?? "#fbfaf6"} onChange={(value) => patch({ paper: value })}/>
              <ColorControl label="Ink" value={lab.ink ?? "#242527"} onChange={(value) => patch({ ink: value })}/>
              <ColorControl label="Accent" value={lab.accent ?? "#856744"} onChange={(value) => patch({ accent: value, labelColor: value, sceneColor: value, ruleColor: value })}/>
              <ColorControl label="Heading" value={lab.headingColor ?? "#242527"} onChange={(value) => patch({ headingColor: value })}/>
            </div>
            <div className="theme-lab-note"><strong>Base + overrides</strong><span>The base theme supplies the structural fallbacks. Theme Lab owns the final typography, chapter treatment and artwork, so exports stay deterministic.</span></div>
          </>}

          {panel === "Body" && <>
            <div className="theme-lab-section-heading"><h3>Body</h3><p>Reading face, density and paragraph rhythm.</p></div>
            <FontControl label="Body typeface" value={lab.bodyFont ?? "EB Garamond"} onChange={(value) => patch({ bodyFont: value })}/>
            <RangeControl label="Type size" value={lab.bodySize ?? 1} min={.72} max={1.5} step={.02} suffix="em" onChange={(value) => patch({ bodySize: value })}/>
            <RangeControl label="Line height" value={lab.lineHeight ?? 1.5} min={1.2} max={2.1} step={.02} onChange={(value) => patch({ lineHeight: value })}/>
            <SelectControl label="Alignment" value={lab.bodyAlign ?? "justify"} onChange={(value) => patch({ bodyAlign: value as "left" | "justify" })}><option value="justify">Justified</option><option value="left">Ragged right</option></SelectControl>
            <RangeControl label="Paragraph indent" value={lab.paragraphIndent ?? 1.25} min={0} max={4} step={.05} suffix="em" onChange={(value) => patch({ paragraphIndent: value })}/>
            <RangeControl label="Paragraph spacing" value={lab.paragraphSpacing ?? 0} min={0} max={3} step={.05} suffix="em" onChange={(value) => patch({ paragraphSpacing: value })}/>
          </>}

          {panel === "Chapter" && <>
            <div className="theme-lab-section-heading"><h3>Chapter opening</h3><p>Build the hierarchy instead of inheriting whatever the base theme happened to like that morning.</p></div>
            <FontControl label="Heading typeface" value={lab.headingFont ?? "Libre Baskerville"} onChange={(value) => patch({ headingFont: value })}/>
            <ColorControl label="Heading color" value={lab.headingColor ?? "#242527"} onChange={(value) => patch({ headingColor: value })}/>
            <RangeControl label="Heading size" value={lab.headingSize ?? 1.8} min={.8} max={4.5} step={.05} suffix="em" onChange={(value) => patch({ headingSize: value })}/>
            <RangeControl label="Tracking" value={lab.headingTracking ?? 0} min={-.08} max={.5} step={.01} suffix="em" onChange={(value) => patch({ headingTracking: value })}/>
            <SelectControl label="Weight" value={String(lab.headingWeight ?? 600)} onChange={(value) => patch({ headingWeight: Number(value) as 400 | 500 | 600 | 700 | 800 | 900 })}>{[400,500,600,700,800,900].map((weight) => <option key={weight} value={weight}>{weight}</option>)}</SelectControl>
            <SelectControl label="Alignment" value={lab.headingAlign ?? "center"} onChange={(value) => patch({ headingAlign: value as "left" | "center" | "right" })}>{alignOptions}</SelectControl>
            <SelectControl label="Case" value={lab.headingCase ?? "normal"} onChange={(value) => patch({ headingCase: value as "normal" | "smallcaps" | "uppercase" })}><option value="normal">Normal</option><option value="smallcaps">Small caps</option><option value="uppercase">Uppercase</option></SelectControl>
            <SelectControl label="Style" value={lab.headingStyle ?? "normal"} onChange={(value) => patch({ headingStyle: value as "normal" | "italic" })}><option value="normal">Roman</option><option value="italic">Italic</option></SelectControl>
            <RangeControl label="Space above" value={lab.headingTop ?? 1.2} min={0} max={8} step={.1} suffix="em" onChange={(value) => patch({ headingTop: value })}/>
            <RangeControl label="Space below" value={lab.headingBottom ?? 2} min={.1} max={8} step={.1} suffix="em" onChange={(value) => patch({ headingBottom: value })}/>

            <div className="theme-lab-subsection"><h4>Chapter label</h4></div>
            {row("Show label", <input type="checkbox" checked={lab.labelVisible !== false} onChange={(event) => patch({ labelVisible: event.target.checked })}/>)}
            {row("Label text", <input value={lab.labelText ?? "CHAPTER"} disabled={lab.labelVisible === false} maxLength={48} onChange={(event) => patch({ labelText: event.target.value })}/>)}
            <ColorControl label="Label color" value={lab.labelColor ?? lab.accent ?? "#856744"} onChange={(value) => patch({ labelColor: value })}/>
            <RangeControl label="Label size" value={lab.labelSize ?? .45} min={.24} max={1.2} step={.01} suffix="em" onChange={(value) => patch({ labelSize: value })}/>
            <RangeControl label="Label tracking" value={lab.labelTracking ?? .2} min={0} max={.7} step={.01} suffix="em" onChange={(value) => patch({ labelTracking: value })}/>

            <div className="theme-lab-subsection"><h4>Subtitle / POV line</h4></div>
            <ColorControl label="Subtitle color" value={lab.subtitleColor ?? "#665f58"} onChange={(value) => patch({ subtitleColor: value })}/>
            <RangeControl label="Subtitle size" value={lab.subtitleSize ?? .92} min={.5} max={2} step={.02} suffix="em" onChange={(value) => patch({ subtitleSize: value })}/>
            <RangeControl label="Subtitle tracking" value={lab.subtitleTracking ?? .04} min={-.05} max={.5} step={.01} suffix="em" onChange={(value) => patch({ subtitleTracking: value })}/>
            <SelectControl label="Subtitle alignment" value={lab.subtitleAlign ?? "center"} onChange={(value) => patch({ subtitleAlign: value as "left" | "center" | "right" })}>{alignOptions}</SelectControl>
            <SelectControl label="Subtitle style" value={lab.subtitleStyle ?? "italic"} onChange={(value) => patch({ subtitleStyle: value as "normal" | "italic" })}><option value="normal">Roman</option><option value="italic">Italic</option></SelectControl>

            <div className="theme-lab-subsection"><h4>Rule / frame</h4></div>
            <SelectControl label="Treatment" value={lab.chapterRule ?? "none"} onChange={(value) => patch({ chapterRule: value as ThemeLabConfig["chapterRule"] })}>
              <option value="none">None</option><option value="top">Top rule</option><option value="bottom">Bottom rule</option><option value="top-bottom">Top and bottom</option>
              <option value="left">Left accent</option><option value="right">Right accent</option><option value="box">Full frame</option>
              <option value="double">Double frame</option><option value="dashed">Dashed frame</option><option value="dotted">Dotted frame</option>
              <option value="shadow">Shadow frame</option><option value="corners">Corner marks</option>
            </SelectControl>
            <ColorControl label="Rule color" value={lab.ruleColor ?? lab.accent ?? "#856744"} onChange={(value) => patch({ ruleColor: value })}/>
            <RangeControl label="Line thickness" value={lab.ruleWidth ?? 1} min={.5} max={8} step={.5} suffix="px" onChange={(value) => patch({ ruleWidth: value })}/>
            <RangeControl label="Frame length" value={lab.ruleLength ?? 100} min={35} max={100} step={1} suffix="%" onChange={(value) => patch({ ruleLength: value })}/>
            <RangeControl label="Inner padding" value={lab.rulePadding ?? .65} min={0} max={3} step={.05} suffix="em" onChange={(value) => patch({ rulePadding: value })}/>
            <RangeControl label="Corner radius" value={lab.ruleRadius ?? 0} min={0} max={40} step={1} suffix="px" onChange={(value) => patch({ ruleRadius: value })}/>

            <div className="theme-lab-subsection"><h4>Drop cap</h4></div>
            {row("Use drop cap", <input type="checkbox" checked={lab.dropcap !== false} onChange={(event) => patch({ dropcap: event.target.checked })}/>)}
            <FontControl label="Drop-cap typeface" value={lab.dropcapFont ?? "Libre Baskerville"} options={dropcapFontOptions} onChange={(value) => patch({ dropcapFont: value })}/>
            <SelectControl label="Drop-cap size" value={lab.dropcapSize ?? "small"} onChange={(value) => patch({ dropcapSize: value as "small" | "large" })}><option value="small">Small · 2 lines</option><option value="large">Large · 3 lines</option></SelectControl>
          </>}

          {panel === "Ornaments" && <>
            <div className="theme-lab-section-heading"><h3>Ornaments & artwork</h3><p>Use a glyph, or replace it with actual artwork. Theme packages keep the image embedded, so nothing goes missing on another machine.</p></div>
            <ArtworkControl title="Chapter heading artwork" image={lab.chapterOrnament} placement onChange={(image) => patch({ chapterOrnament: image })} onUpload={(file) => uploadArtwork("chapterOrnament", file)}/>
            <div className="theme-lab-subsection"><h4>Scene break</h4></div>
            {row("Text ornament", <input value={lab.sceneOrnament ?? "⁂"} maxLength={48} disabled={Boolean(lab.sceneImage?.dataUrl)} onChange={(event) => patch({ sceneOrnament: event.target.value })}/>)}
            <ColorControl label="Ornament color" value={lab.sceneColor ?? lab.accent ?? "#856744"} onChange={(value) => patch({ sceneColor: value })}/>
            <RangeControl label="Text size" value={lab.sceneSize ?? 1.1} min={.5} max={3} step={.05} suffix="em" onChange={(value) => patch({ sceneSize: value })}/>
            <ArtworkControl title="Scene-break artwork" image={lab.sceneImage} onChange={(image) => patch({ sceneImage: image })} onUpload={(file) => uploadArtwork("sceneImage", file)}/>
          </>}

          {panel === "Title Page" && <>
            <div className="theme-lab-section-heading"><h3>Title page</h3><p>The title page inherits your palette but can use its own display face and composition.</p></div>
            <FontControl label="Title typeface" value={lab.titlePageFont ?? lab.headingFont ?? "Libre Baskerville"} onChange={(value) => patch({ titlePageFont: value })}/>
            <RangeControl label="Title size" value={lab.titlePageSize ?? 2.4} min={1} max={5} step={.05} suffix="em" onChange={(value) => patch({ titlePageSize: value })}/>
            <SelectControl label="Alignment" value={lab.titlePageAlign ?? "center"} onChange={(value) => patch({ titlePageAlign: value as "left" | "center" | "right" })}>{alignOptions}</SelectControl>
            {!props.titlePagePreviewId && <div className="theme-lab-note"><strong>No title page in this book</strong><span>The settings are still saved and will apply when a title page exists.</span></div>}
          </>}
        </main>

        <section className="theme-lab-preview">
          <div className="theme-lab-preview-toolbar">
            <div><span>Live preview</span><strong>{lab.name?.trim() || "Untitled Theme"}</strong></div>
            <div className="theme-lab-preview-tabs">
              <button type="button" className={previewTarget === "chapter" ? "active" : ""} disabled={!props.chapterPreviewId} onClick={() => setPreviewTarget("chapter")}>Chapter</button>
              <button type="button" className={previewTarget === "title" ? "active" : ""} disabled={!props.titlePagePreviewId} onClick={() => setPreviewTarget("title")}>Title page</button>
            </div>
          </div>
          <div className="theme-lab-preview-stage">
            {previewLoading && <div className="theme-lab-preview-status">Rendering…</div>}
            {previewError && !previewLoading && <div className="theme-lab-preview-status error">{previewError}</div>}
            {!previewId && <div className="theme-lab-preview-status">Add a chapter to preview this theme.</div>}
            {previewId && previewHtml && <iframe title={(lab.name ?? "Theme") + " live preview"} srcDoc={previewHtml}/>}
          </div>
        </section>
      </div>

      <footer className="theme-lab-footer">
        <div>{error ? <span className="theme-lab-error">{error}</span> : <span>Theme Lab uses Folio's bundled font library so preview, PDF and EPUB stay portable and deterministic across devices.</span>}</div>
        <div className="theme-lab-footer-actions">
          <button type="button" className="theme-lab-button" disabled={busy} onClick={props.onClose}>Cancel</button>
          <button type="button" className="theme-lab-button primary" disabled={busy} onClick={() => void apply()}>{busy ? "Saving…" : "Apply to Book"}</button>
        </div>
      </footer>
    </section>
  </div>;
}
