from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, got {count}")
    p.write_text(text.replace(old, new, 1))


replace_once(
    "server/blues.ts",
    """section.blues-cover { page: bluescover; }
section.blues-toc { page: bluestoc; }
section.chapter { page: chapter; }
""",
    """/* Blues named-page assignment is applied as data-page in render-blues.ts.
   The correction PDF is deliberately theme-neutral. */
""",
)

replace_once(
    "server/pipeline/render-blues.ts",
    """    await page.evaluate(() => {
      document.querySelectorAll("section.chapter").forEach((sec, i) => {
        sec.setAttribute("data-ch", String(i + 1));
        sec.setAttribute("data-break-before", "page");
        sec.querySelectorAll("*").forEach((el) => el.setAttribute("data-ch", String(i + 1)));
      });
      document.querySelector("section.blues-toc")?.setAttribute("data-break-before", "page");
      document.querySelectorAll("a").forEach((a) => {
        a.replaceWith(...Array.from(a.childNodes));
      });
      window.PagedConfig = { auto: false };
    });""",
    """    await page.evaluate(() => {
      // A Blues PDF is intentionally a neutral correction surface, not a second
      // themed edition. Feeding the full book/theme/print stylesheet through
      // Paged.js 0.4.x also exposes its css-tree mutation bug (\"item doesn't
      // belong to list\"). Keep only the dedicated Blues stylesheet before the
      // polyfill parses CSS. Normal preview/EPUB/print rendering is untouched.
      document.querySelectorAll("style").forEach((style) => {
        if (style.id !== "book-formatter-blues") style.remove();
      });
      document.querySelectorAll('link[rel="stylesheet"]').forEach((link) => link.remove());

      // The remaining Blues stylesheet only needs @page geometry and visual
      // rules. Express named pages and forced/avoided breaks directly through
      // the data attributes Paged.js consumes after parsing, avoiding its Breaks
      // handler entirely.
      const breakProperty = /\\b(?:break-before|page-break-before|break-after|page-break-after|page)\\s*:\\s*[^;{}]+;?/gi;
      const bluesStyle = document.getElementById("book-formatter-blues");
      if (bluesStyle) bluesStyle.textContent = (bluesStyle.textContent ?? "").replace(breakProperty, "");

      const cover = document.querySelector("section.blues-cover");
      cover?.setAttribute("data-page", "bluescover");
      const toc = document.querySelector("section.blues-toc");
      toc?.setAttribute("data-page", "bluestoc");
      toc?.setAttribute("data-break-before", "page");

      document.querySelectorAll("section.chapter").forEach((sec, i) => {
        sec.setAttribute("data-ch", String(i + 1));
        sec.setAttribute("data-page", "chapter");
        sec.setAttribute("data-break-before", "page");
        sec.querySelectorAll("*").forEach((el) => el.setAttribute("data-ch", String(i + 1)));
      });
      document.querySelectorAll(".chapter-subtitle,h1,h2,h3,.scene-break").forEach((el) => {
        el.setAttribute("data-break-after", "avoid");
      });
      document.querySelectorAll("a").forEach((a) => {
        a.replaceWith(...Array.from(a.childNodes));
      });
      window.PagedConfig = { auto: false };
    });""",
)
