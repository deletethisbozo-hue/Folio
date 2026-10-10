import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

export const BODY_FONT_FAMILIES = [
  "Source Serif 4", "EB Garamond", "Libre Caslon Text", "Libre Baskerville",
  "Newsreader", "Gelasio", "Vollkorn", "Roboto Slab", "Source Sans 3",
] as const;

export const DROPCAP_FONT_FAMILIES = [
  ...BODY_FONT_FAMILIES,
  "Barlow Condensed", "Bodoni Moda", "Cinzel", "Grenze Gotisch",
  "Jena Gotisch", "Manufacturing Consent", "Kings", "CAT Altenglisch", "Slavkappen",
] as const;

export const DISPLAY_FONT_FAMILIES = [
  ...DROPCAP_FONT_FAMILIES,
  "MedievalSharp", "Pirata One", "Almendra", "Almendra Display",
  "Metamorphous", "Eagle Lake", "New Rocker", "Germania One", "Metal Mania",
  "Fondamento", "Cormorant Unicase", "Berkshire Swash", "Texturina", "Caudex",
  "Rye", "Sancreek", "Nova Cut",
] as const;

export const BUNDLED_FONT_FAMILIES = DISPLAY_FONT_FAMILIES;

export const FONT_TEST_SENTENCE = "Zażółć gęślą jaźń · Write. Format. Publish.";

export function fontStackPrimary(value?: string): string {
  if (!value) return "";
  const first = value.split(",")[0].trim().replace(/^["']|["']$/g, "");
  return first;
}

/** Visible live samples, not OS-controlled <option> labels with inert font styling. */
export default function FontPicker(props: {
  label?: string;
  value?: string;
  defaultFont?: string;
  onChange: (family: string) => void;
  allowDefault?: boolean;
  disabled?: boolean;
  families?: readonly string[];
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState({top:0,left:0,width:300});
  const families = props.families ?? BUNDLED_FONT_FAMILIES;
  const current = fontStackPrimary(props.value);
  const isKnown = families.includes(current);
  const active = isKnown ? current : "";
  const defaults = fontStackPrimary(props.defaultFont) || "base theme";
  const shown = active || (current || defaults);
  const filtered = families.filter((family) => family.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));

  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) { if (event.key === "Escape") {setOpen(false);trigger.current?.focus();} }
    function scroll(event: Event) { if (!popup.current?.contains(event.target as Node)) setOpen(false); }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", scroll);
    return () => {document.removeEventListener("pointerdown", close);document.removeEventListener("keydown", escape);window.removeEventListener("scroll", scroll, true);window.removeEventListener("resize", scroll);};
  }, [open]);

  return <div ref={root} className={"folio-font-picker" + (open ? " open" : "")}>
    {props.label && <span className="folio-font-picker-label">{props.label}</span>}
    <button ref={trigger} type="button" className="folio-font-picker-trigger" disabled={props.disabled}
      aria-expanded={open} aria-controls={id} aria-haspopup="listbox"
      onClick={() => {
        if (!open && trigger.current) {
          const r = trigger.current.getBoundingClientRect();
          const width = Math.min(Math.max(290, r.width), window.innerWidth - 20);
          const top = window.innerHeight - r.bottom >= 315 ? r.bottom + 4 : Math.max(8, r.top - Math.min(375, window.innerHeight - 24) - 4);
          setPlacement({ top, left: Math.max(10, Math.min(r.left, window.innerWidth - width - 10)), width });
        }
        setOpen((wasOpen) => !wasOpen);
        setSearch("");
      }}>
      <span className="folio-font-picker-selected" style={{ fontFamily: `"${shown.replace(/"/g, "")}", serif` }}>
        {active || current || defaults}
      </span>
      <span className="folio-font-picker-description">{active || current ? "Selected font" : "Theme default"}</span>
      <span className="folio-font-picker-chevron" aria-hidden="true">⌄</span>
    </button>
    {open && createPortal(<div ref={popup} id={id} className="folio-font-picker-panel" style={placement} role="listbox" aria-label={props.label || "Typeface"}>
      <input type="search" className="folio-font-picker-search" placeholder="Search typefaces…" autoFocus
        value={search} onChange={(event) => setSearch(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}/>
      <div className="folio-font-picker-options">
        {props.allowDefault && <button type="button" role="option" aria-selected={!current}
          className={"folio-font-picker-option" + (!current ? " selected" : "")}
          onClick={() => { props.onChange(""); setOpen(false); }}>
          <strong>Theme default</strong>
          <span lang="en" style={{ fontFamily: `"${defaults.replace(/"/g, "")}", serif` }}>{FONT_TEST_SENTENCE}</span>
        </button>}
        {filtered.map((family) => <button type="button" key={family} role="option"
          aria-selected={active === family} className={"folio-font-picker-option" + (active === family ? " selected" : "")}
          onClick={() => { props.onChange(family); setOpen(false); }}>
          <strong>{family}</strong>
          <span lang="en" style={{ fontFamily: `"${family}", serif` }}>{FONT_TEST_SENTENCE}</span>
        </button>)}
        {filtered.length === 0 && <div className="folio-font-picker-empty">No matching bundled fonts.</div>}
      </div>
    </div>, document.body)}
  </div>;
}
