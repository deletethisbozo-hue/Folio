const blockTags = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "DIV", "FIGCAPTION", "FIGURE", "FOOTER",
  "HEADER", "MAIN", "NAV", "P", "SECTION",
]);

function children(element: Element): string {
  return Array.from(element.childNodes).map(renderNode).join("");
}

function wrapInline(marker: string, value: string): string {
  const text = value.trim();
  return text ? marker + text + marker : "";
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

  if (element.hasAttribute("data-scene-break")) return "\n\n---\n\n";

  if (tag === "BR") return "  \n";
  if (/^H[1-6]$/.test(tag)) return `${"#".repeat(Number(tag[1]))} ${children(element).trim()}\n\n`;
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
  return Array.from(document.body.childNodes).map(renderNode).join("")
    .replace(/\u00a0/g, " ")
    .replace(/[\u0000\u200B\uFEFF]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ ?([,.;:!?])/g, "$1")
    .trim();
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
      blocks.push(`<div class="editor-scene-break" data-scene-break="true" contenteditable="false"><span>${escapeHtml(ornament)}</span></div>`);
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
