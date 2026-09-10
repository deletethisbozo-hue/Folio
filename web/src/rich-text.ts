const blockTags = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "DIV", "FIGCAPTION", "FIGURE", "FOOTER",
  "HEADER", "MAIN", "NAV", "P", "SECTION",
]);

function children(element: Element): string {
  return Array.from(element.childNodes).map(renderNode).join("");
}

function wrapInline(marker: string, value: string): string {
  // Writer and Word split a sentence into many styled spans. Trimming each span
  // glues words together ("one <b>two</b> three" became "one**two**three").
  // Keep boundary whitespace outside the Markdown marker instead.
  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  const text = value.slice(leading.length, value.length - trailing.length || undefined);
  return text ? leading + marker + text + marker + trailing : value;
}

function renderList(element: Element, ordered: boolean, depth = 0): string {
  const rows: string[] = [];
  let number = 1;
  for (const child of Array.from(element.children)) {
    if (child.tagName !== "LI") continue;
    const nested = Array.from(child.children).filter((item) => item.tagName === "UL" || item.tagName === "OL");
    const clone = child.cloneNode(true) as Element;
    clone.querySelectorAll("ul,ol").forEach((item) => item.remove());
    const prefix = ordered ? `${number++}. ` : "- ";
    rows.push("  ".repeat(depth) + prefix + children(clone).trim());
    for (const list of nested) rows.push(renderList(list, list.tagName === "OL", depth + 1).trimEnd());
  }
  return rows.join("\n") + "\n\n";
}

function renderTable(element: Element): string {
  const rows = Array.from(element.querySelectorAll("tr")).map((row) =>
    Array.from(row.querySelectorAll(":scope > th, :scope > td")).map((cell) => children(cell).trim().replace(/\|/g, "\\|")),
  ).filter((row) => row.length);
  if (!rows.length) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const padded = rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill("")]);
  const header = padded[0];
  return `| ${header.join(" | ")} |\n| ${header.map(() => "---").join(" | ")} |\n` +
    padded.slice(1).map((row) => `| ${row.join(" | ")} |`).join("\n") + "\n\n";
}

function renderNode(node: Node): string {
  if (node.nodeType === 3) return (node.textContent ?? "").replace(/[\t\r\n ]+/g, " ");
  if (node.nodeType !== 1) return "";
  const element = node as Element;
  const tag = element.tagName;

  if (["STYLE", "SCRIPT", "META", "LINK", "TITLE", "XML"].includes(tag)) return "";

  if (element.hasAttribute("data-scene-break")) return "\n\n---\n\n";

  // Clipboard HTML from Word, Pages and LibreOffice often contains a <br> at
  // every visual line ending. A Markdown hard break (two trailing spaces)
  // forces the browser to justify that artificially short line and produces
  // enormous gaps between words. Keep it as a Markdown soft break: prose
  // reflows naturally, while the source boundary is still retained.
  if (tag === "BR") return "\n";
  if (/^H[1-6]$/.test(tag)) return `${"#".repeat(Number(tag[1]))} ${children(element).trim()}\n\n`;
  // LibreOffice and Word frequently copy headings as styled paragraphs rather
  // than semantic <h1>. Their stable class names are more useful than the many
  // vendor-specific CSS declarations in the clipboard payload.
  if (tag === "P") {
    const cls = `${element.className || ""} ${element.getAttribute("style") || ""}`;
    const heading = cls.match(/(?:heading|nag[łl][óo]wek|msoheading)[_\s-]*(?:20_)?([1-6])\b/i);
    if (heading) return `${"#".repeat(Number(heading[1]))} ${children(element).trim()}\n\n`;
  }
  if (tag === "STRONG" || tag === "B") return wrapInline("**", children(element));
  if (tag === "EM" || tag === "I") return wrapInline("*", children(element));
  if (tag === "U") return children(element).trim() ? `<u>${children(element).trim()}</u>` : "";
  if (tag === "S" || tag === "STRIKE" || tag === "DEL") return wrapInline("~~", children(element));
  if (tag === "SUP") return children(element).trim() ? `<sup>${children(element).trim()}</sup>` : "";
  if (tag === "SUB") return children(element).trim() ? `<sub>${children(element).trim()}</sub>` : "";
  if (tag === "A") {
    const label = children(element).trim();
    const href = element.getAttribute("href")?.trim();
    return href && label ? `[${label}](${href})` : label;
  }
  if (tag === "UL" || tag === "OL") return renderList(element, tag === "OL");
  if (tag === "BLOCKQUOTE") return children(element).trim().split("\n").map((line) => `> ${line}`).join("\n") + "\n\n";
  if (tag === "PRE") return `\`\`\`\n${element.textContent?.replace(/\r\n/g, "\n").trimEnd() ?? ""}\n\`\`\`\n\n`;
  if (tag === "TABLE") return renderTable(element);
  if (tag === "IMG") return element.getAttribute("alt")?.trim() || "";

  let value = children(element);
  const style = element.getAttribute("style") ?? "";
  if (/font-weight\s*:\s*(?:bold|[6-9]00)/i.test(style)) value = wrapInline("**", value);
  if (/font-style\s*:\s*italic/i.test(style)) value = wrapInline("*", value);
  if (/text-decoration(?:-line)?\s*:[^;]*underline/i.test(style) && value.trim()) value = `<u>${value.trim()}</u>`;
  return blockTags.has(tag) ? value.trim() + "\n\n" : value;
}

/** Convert HTML clipboard data from LibreOffice/Word/browser editors to clean Markdown. */
export function richTextToMarkdown(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  // Office suites put bold/italic/underline in generated classes (T1,
  // MsoStrong, …), not necessarily inline. Resolve their simple declarations
  // once so the semantic conversion does not throw rich formatting away.
  const classStyles = new Map<string, string>();
  for (const sheet of Array.from(document.querySelectorAll("style"))) {
    const css = sheet.textContent ?? "";
    for (const match of css.matchAll(/\.([_a-zA-Z][\w-]*)[^,{]*\{([^}]*)\}/g)) {
      classStyles.set(match[1], `${classStyles.get(match[1]) ?? ""};${match[2]}`);
    }
  }
  document.body.querySelectorAll("[class]").forEach((element) => {
    const fromClasses = Array.from(element.classList).map((name) => classStyles.get(name) ?? "").join(";");
    if (fromClasses) element.setAttribute("style", `${fromClasses};${element.getAttribute("style") ?? ""}`);
  });
  return Array.from(document.body.childNodes).map(renderNode).join("")
    .replace(/\u00a0/g, " ")
    .replace(/[\u0000\u200B\uFEFF]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ ?([,.;:!?])/g, "$1")
    .trim();
}

/** Plain clipboard text is not automatically Markdown. Writer copies one
 * paragraph per physical line; treating those newlines as Markdown soft-wraps
 * destroys every paragraph. Explicit Markdown constructs keep their original
 * meaning, while ordinary multi-line prose gets real paragraph boundaries. */
export function plainTextToMarkdown(value: string): string {
  const text = value.replace(/\r\n?/g, "\n").replace(/[\u0000\u200B\uFEFF]/g, "").trim();
  if (!text) return "";
  const looksLikeMarkdown = /^(?:#{1,6}\s|>\s|[-+*]\s|\d+[.)]\s|```|~~~|---\s*$)/m.test(text)
    || /(?:\*\*[^*]+\*\*|\[[^\]]+\]\([^\s)]+\)|<u>)/.test(text);
  if (looksLikeMarkdown || /\n\s*\n/.test(text)) return text;
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.length > 1 ? lines.join("\n\n") : text;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inlineMarkdown(value: string): string {
  let html = escapeHtml(value);
  html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/~~([^~\n]+)~~/g, "<s>$1</s>");
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  html = html.replace(/&lt;u&gt;([\s\S]*?)&lt;\/u&gt;/gi, "<u>$1</u>");
  return html.replace(/  \n/g, "<br>");
}

/** A deliberately small, deterministic editor renderer. Publishing still goes
 * through Pandoc; this only gives the writing surface a clean WYSIWYG view. */
export function markdownToEditorHtml(markdown: string, ornament = "❦"): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; rows: string[] } | null = null;
  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${inlineMarkdown(paragraph.join("\n"))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const tag = list.ordered ? "ol" : "ul";
    blocks.push(`<${tag}>${list.rows.map((row) => `<li>${inlineMarkdown(row)}</li>`).join("")}</${tag}>`);
    list = null;
  };
  const flush = () => { flushParagraph(); flushList(); };

  for (const line of lines) {
    if (/^\s*(?:---|\* \* \*)\s*$/.test(line)) {
      flush();
      blocks.push(`<div class="editor-scene-break" data-scene-break="true" contenteditable="false"><span>${escapeHtml(ornament)}</span><button type="button" class="editor-scene-break-remove" aria-label="Remove scene break" title="Remove scene break">×</button></div>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flush();
      blocks.push(`<h${heading[1].length}>${inlineMarkdown(heading[2])}</h${heading[1].length}>`);
      continue;
    }
    const item = line.match(/^\s*(?:(\d+)[.)]|[-+*])\s+(.+)$/);
    if (item) {
      flushParagraph();
      const ordered = Boolean(item[1]);
      if (!list || list.ordered !== ordered) flushList();
      list ??= { ordered, rows: [] };
      list.rows.push(item[2]);
      continue;
    }
    if (/^>\s?/.test(line)) {
      flush();
      blocks.push(`<blockquote><p>${inlineMarkdown(line.replace(/^>\s?/, ""))}</p></blockquote>`);
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    flushList();
    paragraph.push(line);
  }
  flush();
  return blocks.join("") || "<p><br></p>";
}

/** Render server-generated matter in the read-only editor without exposing its
 * internal HTML implementation. Only plain text and a small set of known
 * presentation classes survive; arbitrary markup is never trusted. */
export function generatedMatterToEditorHtml(markup: string): string {
  const source = new DOMParser().parseFromString(markup, "text/html");
  const allowedClasses = new Set(["tp-subtitle", "tp-author", "tp-series", "tp-publisher"]);
  const blocks = Array.from(source.body.querySelectorAll("p, li"))
    .map((node) => {
      const className = Array.from(node.classList).find((name) => allowedClasses.has(name));
      const classAttr = className ? ` class="${className}"` : "";
      return `<p${classAttr}>${escapeHtml(node.textContent?.trim() ?? "")}</p>`;
    })
    .filter((block) => !/^<p(?: class="[^"]+")?><\/p>$/.test(block));
  if (blocks.length) return blocks.join("");
  const text = source.body.textContent?.trim() ?? "";
  return text ? `<p>${escapeHtml(text)}</p>` : "<p><br></p>";
}

/** Fast in-frame draft rendering. Pandoc remains authoritative and replaces
 * this result after its debounced render; this version makes a 100k-word paste
 * visible immediately instead of leaving a blank reader while Pandoc works. */
export function markdownToPreviewHtml(markdown: string, ornament = "❦"): string {
  // Also heal hard breaks saved by Folio <=1.0.1. The Pandoc/Lua path applies
  // the same repair, so immediate and authoritative previews agree.
  const reflowed = markdown.replace(/ {2,}\n(?=\S)/g, "\n");
  return markdownToEditorHtml(reflowed, ornament)
    .replace(/<button\b[^>]*class="editor-scene-break-remove"[^>]*>.*?<\/button>/g, "")
    .replace(/class="editor-scene-break"/g, 'class="scene-break" role="separator"')
    .replace(/\scontenteditable="false"/g, "");
}

/** Conservative language detection used only when the book is still on the
 * default English metadata but the pasted manuscript is unambiguously Polish. */
export function detectPastedLanguage(markdown: string): "pl" | null {
  const sample = markdown.slice(0, 120_000).toLocaleLowerCase();
  const diacritics = sample.match(/[ąćęłńóśźż]/g)?.length ?? 0;
  const functionWords = sample.match(/\b(?:się|nie|jest|oraz|który|która|przez|jego|jej|był|była|żeby|może|tylko|jeszcze|tego|tych)\b/g)?.length ?? 0;
  return sample.length >= 400 && (diacritics >= 8 || (diacritics >= 3 && functionWords >= 8)) ? "pl" : null;
}
