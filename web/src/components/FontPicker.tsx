import { useEffect, useId, useRef, useState } from "react";

export const BUNDLED_FONT_FAMILIES = [
  "Source Serif 4", "Source Sans 3", "EB Garamond", "Libre Caslon Text",
  "Libre Baskerville", "Newsreader", "Gelasio", "Vollkorn",
  "Barlow Condensed", "Bodoni Moda", "Cinzel", "Grenze Gotisch",
  "Roboto Slab", "Jena Gotisch", "Manufacturing Consent", "Kings",
  "CAT Altenglisch", "Slavkappen",
] as const;

export const FONT_TEST_SENTENCE = "Zażółć gęślą jaźń · ĄĆĘŁŃÓŚŹŻ";

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
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return <div ref={root} className={"folio-font-picker" + (open ? " open" : "")}>
    {props.label && <span className="folio-font-picker-label">{props.label}</span>}
    <button type="button" className="folio-font-picker-trigger" disabled={props.disabled}
      aria-expanded={open} aria-controls={id} aria-haspopup="listbox"
      onClick={() => setOpen((wasOpen) => !wasOpen)}>
      <span className="folio-font-picker-selected" style={{ fontFamily: `"${shown.replace(/"/g, "")}", serif` }}>
        {active || current || defaults}
      </span>
      <span className="folio-font-picker-description">{active || current ? "Selected font" : "Theme default"}</span>
      <span className="folio-font-picker-chevron" aria-hidden="true">⌄</span>
    </button>
    {open && <div id={id} className="folio-font-picker-panel" role="listbox" aria-label={props.label || "Typeface"}>
      <input type="search" className="folio-font-picker-search" placeholder="Search typefaces…" autoFocus
        value={search} onChange={(event) => setSearch(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}/>
      <div className="folio-font-picker-options">
        {props.allowDefault && <button type="button" role="option" aria-selected={!current}
          className={"folio-font-picker-option" + (!current ? " selected" : "")}
          onClick={() => { props.onChange(""); setOpen(false); }}>
          <strong>Theme default</strong>
          <span style={{ fontFamily: `"${defaults.replace(/"/g, "")}", serif` }}>{defaults}</span>
        </button>}
        {filtered.map((family) => <button type="button" key={family} role="option"
          aria-selected={active === family} className={"folio-font-picker-option" + (active === family ? " selected" : "")}
          onClick={() => { props.onChange(family); setOpen(false); }}>
          <strong>{family}</strong>
          <span lang="pl" style={{ fontFamily: `"${family}", serif` }}>{FONT_TEST_SENTENCE}</span>
        </button>)}
        {filtered.length === 0 && <div className="folio-font-picker-empty">No matching bundled fonts.</div>}
      </div>
    </div>}
    <div className="folio-font-picker-sample" lang="pl"
      style={{ fontFamily: `"${shown.replace(/"/g, "")}", serif` }}>
      {FONT_TEST_SENTENCE}
    </div>
  </div>;
}
