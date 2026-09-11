from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "scripts/v107-visual-qa.ts"
value = path.read_text(encoding="utf-8")
old = '''    (window as Window & { __folioQaParagraphText?: (paragraph: HTMLElement) => string }).__folioQaParagraphText = (paragraph) => {
      const lines = [...paragraph.querySelectorAll<HTMLElement>(":scope > .folio-composed-line")];
      if (!lines.length) return (paragraph.textContent ?? "").replace(/\\u00ad/g, "").replace(/\\s+/g, " ").trim();
      return lines.map((line, index) => {
        let text = (line.textContent ?? "").replace(/\\u00ad/g, "");
        const nextWord = lines[index + 1]?.querySelector<HTMLElement>(".folio-word");
        const discretionary = nextWord?.dataset.folioHyphenBefore === "true" && text.endsWith("-");
        if (discretionary) text = text.slice(0, -1);
        else if (index < lines.length - 1) text += " ";
        return text;
      }).join("").replace(/\\s+/g, " ").trim();
    };
'''
new = '''    (window as Window & { __folioQaParagraphText?: (paragraph: HTMLElement) => string }).__folioQaParagraphText = (paragraph) => {
      const lines = [...paragraph.querySelectorAll<HTMLElement>(":scope > .folio-composed-line")];
      if (!lines.length) return (paragraph.textContent ?? "").replace(/\\u00ad/g, "").replace(/\\s+/g, " ").trim();
      const capText = (paragraph.querySelector<HTMLElement>(":scope > .dropcap")?.textContent ?? "")
        .replace(/\\u00ad/g, "")
        .replace(/\\s+/g, "")
        .trim();
      const lineText = lines.map((line, index) => {
        let text = (line.textContent ?? "").replace(/\\u00ad/g, "");
        const nextWord = lines[index + 1]?.querySelector<HTMLElement>(".folio-word");
        const discretionary = nextWord?.dataset.folioHyphenBefore === "true" && text.endsWith("-");
        if (discretionary) text = text.slice(0, -1);
        else if (index < lines.length - 1) text += " ";
        return text;
      }).join("");
      // Drop caps are removed from the line fragments and positioned separately,
      // so prepend their glyph without adding a space. This reconstructs the
      // semantic first word ("P" + "oczucie" => "Poczucie") for QA freshness.
      return `${capText}${lineText}`.replace(/\\s+/g, " ").trim();
    };
'''
if new not in value:
    if old not in value:
        raise RuntimeError("expected paragraph helper marker missing")
    path.write_text(value.replace(old, new, 1), encoding="utf-8")
print("Made QA semantic paragraph reconstruction dropcap-aware")
