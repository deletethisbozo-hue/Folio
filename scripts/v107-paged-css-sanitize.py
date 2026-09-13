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
    """/* Named-page assignment is applied as data-page in render-blues.ts.
   Keeping it out of the stylesheet avoids Paged.js mutating the css-tree
   declaration list for properties we already know semantically. */
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
      // Paged.js 0.x removes page/break declarations from css-tree while parsing.
      // With Folio's combined base + theme + Blues stylesheet this can make two
      // handlers mutate the same list item and throw \"item doesn't belong to list\".
      // Blues knows the required pagination semantics already, so strip only these
      // properties in this render mode and express them as the data attributes the
      // Paged.js layout engine consumes after parsing. Normal print/EPUB/preview CSS
      // is untouched.
      const breakProperty = /\\b(?:break-before|page-break-before|break-after|page-break-after|page)\\s*:\\s*[^;{}]+;?/gi;
      document.querySelectorAll("style").forEach((style) => {
        style.textContent = (style.textContent ?? "").replace(breakProperty, "");
      });

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
