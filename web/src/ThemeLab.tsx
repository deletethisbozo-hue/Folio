import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
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
  ["Folio EB Garamond", "EB Garamond"],
  ["Folio Libre Caslon Text", "Libre Caslon"],
  ["Folio Libre Baskerville", "Libre Baskerville"],
  ["Folio Newsreader", "Newsreader"],
  ["Folio Vollkorn", "Vollkorn"],
  ["Folio Source Serif 4", "Source Serif 4"],
  ["Folio Source Sans 3", "Source Sans 3"],
  ["Folio Barlow Condensed", "Barlow Condensed"],
  ["Folio Bodoni Moda", "Bodoni Moda"],
  ["Folio Cinzel", "Cinzel"],
  ["Folio Grenze Gotisch", "Grenze Gotisch"],
  ["Folio Roboto Slab", "Roboto Slab"],
  ["Folio Jena Gotisch", "Jena Gotisch"],
  ["Folio Manufacturing Consent", "Manufacturing Consent"],
  ["Folio Kings", "Kings"],
  ["Folio CAT Altenglisch", "CAT Altenglisch"],
  ["Folio Slavkappen", "Slavkappen"],
  ["Georgia, serif", "Georgia"],
  ["Arial, sans-serif", "Arial"],
] as const;

function numberValue(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function selectedTheme(themes: Theme[], name: string): Theme | undefined {
  return themes.find((theme) => theme.name === name) ?? themes[0];
}

function defaultConfig(theme: Theme | undefined, typography: Typography): ThemeLabConfig {
  if (typography.themeLab?.enabled) return { ...typography.themeLab, enabled: true };
  return {
    enabled: true,
    name: "My Theme",
    paper: theme?.previewPaper ?? "#fbfaf6",
    ink: "#242527",
    accent: theme?.previewAccent ?? "#856744",
    bodyFont: typography.bodyFont ?? theme?.previewFont ?? "Folio EB Garamond",
    bodySize: numberValue(String(typography.fontSize ?? "1").replace("em", ""), 1),
    lineHeight: numberValue(typography.lineHeight, 1.5),
    bodyAlign: typography.bodyAlign ?? "justify",
    paragraphIndent: numberValue(String(typography.paragraphIndent ?? "1.25").replace("em", ""), 1.25),
    paragraphSpacing: numberValue(String(typography.paragraphSpacing ?? "0").replace("em", ""), 0),
    headingFont: typography.headingFont ?? theme?.previewHeadingFont ?? "Folio Libre Baskerville",
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
    dropcapFont: typography.dropcapFont ?? typography.headingFont ?? theme?.previewHeadingFont ?? "Folio Libre Baskerville",
    sceneOrnament: typography.sceneOrnament ?? theme?.sceneOrnament ?? "⁂",
    sceneSize: 1.1,
    sceneColor: theme?.previewAccent ?? "#856744",
    chapterRule: "none",
    ruleWidth: 1,
    ruleColor: theme?.previewAccent ?? "#856744",
    titlePageFont: typography.titlePageFont ?? typography.headingFont ?? theme?.previewHeadingFont ?? "Folio Libre Baskerville",
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
    dropcapFont: lab.dropcapFont,
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
  if (file.size > 3 * 1024 * 1024) throw new Error("Theme artwork must be 3 MB or smaller.");
  if (!["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(file.type)) {
    throw new Error("Use PNG, JPEG, WebP or SVG artwork.");
  }
  if (file.type !== "image/svg+xml") return readBlobAsDataUrl(file);

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
    <input type="range" min={props.min} max={props.max} step={props.step} value={props.value} onChange={(event) => props.onChange(Number(event.target.value))}/>
    <output>{props.value}{props.suffix ?? ""}</output>
  </label>;
}

function SelectControl(props: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return <label className="theme-lab-row"><span>{props.label}</span><select value={props.value} onChange={(event) => props.onChange(event.target.value)}>{props.children}</select></label>;
}

function ColorControl(props: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="theme-lab-row color-row"><span>{props.label}</span><span className="theme-lab-color"><input type="color" value={props.value} onChange={(event) => props.onChange(event.target.value)}/><input value={props.value} maxLength={9} onChange={(event) => props.onChange(event.target.value)}/></span></label>;
}

function FontControl(props: { label: string; value: string; installedFonts: string[]; onChange: (value: string) => void }) {
  const builtInValues = new Set(fontOptions.map(([value]) => value));
  const installed = props.installedFonts.filter((family) => !builtInValues.has(family as (typeof fontOptions)[number][0]));
  const known = builtInValues.has(props.value as (typeof fontOptions)[number][0]) || installed.includes(props.value);
  return <label className="theme-lab-row theme-lab-font-row">
    <span>{props.label}</span>
    <div className="theme-lab-font-picker">
      <select value={known ? props.value : "__custom__"} onChange={(event) => {
        if (event.target.value !== "__custom__") props.onChange(event.target.value);
      }}>
        <optgroup label="Folio built-ins">
          {fontOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </optgroup>
        {installed.length > 0 && <optgroup label="Fonts on this computer">
          {installed.map((family) => <option key={family} value={family}>{family}</option>)}
        </optgroup>}
        <option value="__custom__">Custom font name…</option>
      </select>
      <input
        className="theme-lab-font-custom"
        value={known ? "" : props.value}
        placeholder="Type any installed font family"
        onChange={(event) => props.onChange(event.target.value)}
      />
    </div>
  </label>;
}

function ArtworkControl(props: {
  title: string;
  image?: ThemeLabImage;
  placement?: boolean;
  onChange: (image?: ThemeLabImage) => void;
  onUpload: (file: File) => Promise<void>;
}) {
  const image = props.image;
  return <section className="theme-lab-artwork-card">
    <div className="theme-lab-artwork-head">
      <div><strong>{props.title}</strong><small>Transparent PNG/WebP or SVG works best.</small></div>
      {image?.dataUrl && <button type="button" className="native-button compact" onClick={() => props.onChange(undefined)}>Remove</button>}
    </div>
    <label className="theme-lab-artwork-drop">
      {image?.dataUrl ? <img src={image.dataUrl} alt="Theme artwork preview"/> : <span>Drop in an ornament or illustration</span>}
      <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void props.onUpload(file);
        event.currentTarget.value = "";
      }}/>
    </label>
    {image?.dataUrl && <div className="theme-lab-artwork-controls">
      {props.placement && <SelectControl label="Placement" value={image.placement ?? "below"} onChange={(value) => props.onChange({ ...image, placement: value as "above" | "below" })}><option value="above">Above chapter title</option><option value="below">Below chapter title</option></SelectControl>}
      <RangeControl label="Width" value={image.width ?? 34} min={6} max={100} step={1} suffix="%" onChange={(value) => props.onChange({ ...image, width: value })}/>
      <RangeControl label="Height" value={image.height ?? 3.2} min={.6} max={12} step={.1} suffix="em" onChange={(value) => props.onChange({ ...image, height: value })}/>
      <RangeControl label="Gap" value={image.gap ?? .7} min={0} max={5} step={.1} suffix="em" onChange={(value) => props.onChange({ ...image, gap: value })}/>
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
  const [installedFonts, setInstalledFonts] = useState<string[]>([]);
  const [fontAccessState, setFontAccessState] = useState<"idle" | "loading" | "ready" | "unavailable" | "denied">("idle");
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

  async function loadInstalledFonts() {
    setError(null);
    const localFontWindow = window as Window & {
      queryLocalFonts?: () => Promise<Array<{ family: string; fullName?: string; postscriptName?: string; style?: string }>>;
    };
    if (typeof localFontWindow.queryLocalFonts !== "function") {
      setFontAccessState("unavailable");
      setError("This build cannot enumerate local fonts. You can still type a font family name manually.");
      return;
    }
    setFontAccessState("loading");
    try {
      const fonts = await localFontWindow.queryLocalFonts();
      const families = [...new Set(fonts.map((font) => font.family?.trim()).filter((family): family is string => Boolean(family)))].sort((a, b) => a.localeCompare(b));
      setInstalledFonts(families);
      setFontAccessState("ready");
    } catch (reason) {
      const name = reason instanceof DOMException ? reason.name : "";
      setFontAccessState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable");
      setError(name === "NotAllowedError"
        ? "Local font access was not granted. Theme Lab can still use a font if you type its family name."
        : reason instanceof Error ? reason.message : String(reason));
    }
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
      if (file.size > 8 * 1024 * 1024) throw new Error("Theme package is unexpectedly large.");
      const parsed = JSON.parse(await file.text()) as Partial<ThemePackage>;
      if (parsed.format !== "folio-theme" || parsed.version !== 1 || !parsed.config || typeof parsed.config !== "object") {
        throw new Error("That is not a Folio Theme Lab package.");
      }
      const theme = props.themes.find((item) => item.name === parsed.baseTheme);
      if (!theme) throw new Error("The package uses a base theme this Folio build does not know.");
      setBaseTheme(theme.name);
      setLab({ ...defaultConfig(theme, {}), ...parsed.config, enabled: true });
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
          <button type="button" className="native-button" onClick={() => importRef.current?.click()}>Import Theme</button>
          <input ref={importRef} className="theme-lab-hidden-input" type="file" accept=".json,.folio-theme.json,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importPackage(file); event.currentTarget.value = ""; }}/>
          <button type="button" className="native-button" onClick={exportPackage}>Export Theme</button>
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
            <div className="theme-lab-font-access">
              <div><strong>Computer fonts</strong><span>{fontAccessState === "ready" ? `${installedFonts.length} font families loaded from this computer.` : "Use any font installed on this machine, not only Folio's bundled faces."}</span></div>
              <button type="button" className="native-button" disabled={fontAccessState === "loading"} onClick={() => void loadInstalledFonts()}>{fontAccessState === "loading" ? "Reading fonts…" : fontAccessState === "ready" ? "Refresh fonts" : "Load installed fonts"}</button>
            </div>
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
            <FontControl label="Body typeface" value={lab.bodyFont ?? "Folio EB Garamond"} installedFonts={installedFonts} onChange={(value) => patch({ bodyFont: value })}/>
            <RangeControl label="Type size" value={lab.bodySize ?? 1} min={.72} max={1.5} step={.02} suffix="em" onChange={(value) => patch({ bodySize: value })}/>
            <RangeControl label="Line height" value={lab.lineHeight ?? 1.5} min={1.2} max={2.1} step={.02} onChange={(value) => patch({ lineHeight: value })}/>
            <SelectControl label="Alignment" value={lab.bodyAlign ?? "justify"} onChange={(value) => patch({ bodyAlign: value as "left" | "justify" })}><option value="justify">Justified</option><option value="left">Ragged right</option></SelectControl>
            <RangeControl label="Paragraph indent" value={lab.paragraphIndent ?? 1.25} min={0} max={4} step={.05} suffix="em" onChange={(value) => patch({ paragraphIndent: value })}/>
            <RangeControl label="Paragraph spacing" value={lab.paragraphSpacing ?? 0} min={0} max={3} step={.05} suffix="em" onChange={(value) => patch({ paragraphSpacing: value })}/>
          </>}

          {panel === "Chapter" && <>
            <div className="theme-lab-section-heading"><h3>Chapter opening</h3><p>Build the hierarchy instead of inheriting whatever the base theme happened to like that morning.</p></div>
            <FontControl label="Heading typeface" value={lab.headingFont ?? "Folio Libre Baskerville"} installedFonts={installedFonts} onChange={(value) => patch({ headingFont: value })}/>
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
            <SelectControl label="Treatment" value={lab.chapterRule ?? "none"} onChange={(value) => patch({ chapterRule: value as ThemeLabConfig["chapterRule"] })}><option value="none">None</option><option value="top">Top rule</option><option value="bottom">Bottom rule</option><option value="left">Left rule</option><option value="box">Box</option></SelectControl>
            <ColorControl label="Rule color" value={lab.ruleColor ?? lab.accent ?? "#856744"} onChange={(value) => patch({ ruleColor: value })}/>
            <RangeControl label="Rule width" value={lab.ruleWidth ?? 1} min={.5} max={8} step={.5} suffix="px" onChange={(value) => patch({ ruleWidth: value })}/>

            <div className="theme-lab-subsection"><h4>Drop cap</h4></div>
            {row("Use drop cap", <input type="checkbox" checked={lab.dropcap !== false} onChange={(event) => patch({ dropcap: event.target.checked })}/>)}
            <FontControl label="Drop-cap typeface" value={lab.dropcapFont ?? lab.headingFont ?? "Folio Libre Baskerville"} installedFonts={installedFonts} onChange={(value) => patch({ dropcapFont: value })}/>
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
            <FontControl label="Title typeface" value={lab.titlePageFont ?? lab.headingFont ?? "Folio Libre Baskerville"} installedFonts={installedFonts} onChange={(value) => patch({ titlePageFont: value })}/>
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
        <div>{error ? <span className="theme-lab-error">{error}</span> : <span>Theme Lab settings are stored inside the book. Local fonts render on this computer; EPUB portability still depends on whether that font is embedded or available on the reading device.</span>}</div>
        <button type="button" className="native-button" disabled={busy} onClick={props.onClose}>Cancel</button>
        <button type="button" className="native-button primary" disabled={busy} onClick={() => void apply()}>{busy ? "Saving…" : "Apply to Book"}</button>
      </footer>
    </section>
  </div>;
}
