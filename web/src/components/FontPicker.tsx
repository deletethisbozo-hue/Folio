import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

export const BODY_FONT_FAMILIES = [
  "Source Serif 4", "EB Garamond", "Libre Caslon Text", "Libre Baskerville",
  "Newsreader", "Gelasio", "Vollkorn", "Roboto Slab", "Source Sans 3",
] as const;

export const GOTHIC_DISPLAY_FONT_FAMILIES = [
  "Grenze Gotisch", "Fruktur", "Pirata One", "New Rocker", "Jacquarda Bastarda 9",
  "Jaini Purva", "Jaini", "Jim Nightshade", "Texturina", "Manufacturing Consent",
  "Newspaper Text", "KJV1611", "GL-StellaMystica", "GL-StarTaker", "Gothic GumDrop",
  "Blaka", "Blaka Hollow", "Blaka Ink", "GL-GermanCursive", "GL-Morris",
] as const;

export const MEDIEVAL_DISPLAY_FONT_FAMILIES = [
  "MedievalSharp", "Almendra", "Metamorphous", "Eagle Lake", "Fondamento",
  "Caudex", "Cormorant Unicase", "Berkshire Swash", "Risque", "Kings", "Grenze",
] as const;

export const GENERAL_DISPLAY_FONT_FAMILIES = [
  "Barlow Condensed", "Bodoni Moda", "Cinzel", "Rakkas", "Sancreek", "Nova Cut",
] as const;

export const DROPCAP_FONT_FAMILIES = [
  ...BODY_FONT_FAMILIES,
  ...GOTHIC_DISPLAY_FONT_FAMILIES,
  ...MEDIEVAL_DISPLAY_FONT_FAMILIES,
  ...GENERAL_DISPLAY_FONT_FAMILIES,
] as const;

export const DISPLAY_FONT_FAMILIES = DROPCAP_FONT_FAMILIES;
export const BUNDLED_FONT_FAMILIES = DISPLAY_FONT_FAMILIES;

export const FONT_TEST_SENTENCE = "Write. Format. Publish.";

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
  const hasDisplayFamilies = families.some((family) =>
    GOTHIC_DISPLAY_FONT_FAMILIES.includes(family as (typeof GOTHIC_DISPLAY_FONT_FAMILIES)[number])
    || MEDIEVAL_DISPLAY_FONT_FAMILIES.includes(family as (typeof MEDIEVAL_DISPLAY_FONT_FAMILIES)[number])
  );
  const grouped = (hasDisplayFamilies ? [
    { label: "Blackletter / Gothic", families: GOTHIC_DISPLAY_FONT_FAMILIES.filter((family) => filtered.includes(family)) },
    { label: "Medieval / Historical", families: MEDIEVAL_DISPLAY_FONT_FAMILIES.filter((family) => filtered.includes(family)) },
    { label: "Book / General", families: filtered.filter((family) =>
      !GOTHIC_DISPLAY_FONT_FAMILIES.includes(family as (typeof GOTHIC_DISPLAY_FONT_FAMILIES)[number])
      && !MEDIEVAL_DISPLAY_FONT_FAMILIES.includes(family as (typeof MEDIEVAL_DISPLAY_FONT_FAMILIES)[number])
    ) },
  ] : [{ label: "Book typefaces", families: filtered }]).filter((group) => group.families.length > 0);

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
        {grouped.map((group) => <div key={group.label} className="folio-font-picker-group" role="group" aria-label={group.label}>
          <div className="folio-font-picker-group-label">{group.label}</div>
          {group.families.map((family) => <button type="button" key={family} role="option"
            aria-selected={active === family} className={"folio-font-picker-option" + (active === family ? " selected" : "")}
            onClick={() => { props.onChange(family); setOpen(false); }}>
            <strong>{family}</strong>
            <span lang="en" style={{ fontFamily: `"${family}", serif` }}>{FONT_TEST_SENTENCE}</span>
          </button>)}
        </div>)}
        {filtered.length === 0 && <div className="folio-font-picker-empty">No matching bundled fonts.</div>}
      </div>
    </div>, document.body)}
  </div>;
}
