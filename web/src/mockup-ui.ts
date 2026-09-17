function svgIcon(kind: "book" | "page" | "cover") {
  const path = kind === "book"
    ? '<path d="M4 5.5c2.7-1 5.3-.8 8 .8v12c-2.7-1.6-5.3-1.8-8-.8z"/><path d="M20 5.5c-2.7-1-5.3-.8-8 .8v12c2.7-1.6 5.3-1.8 8-.8z"/>'
    : kind === "cover"
      ? '<rect x="5" y="3.5" width="14" height="17" rx="1.5"/><path d="m8 16 3.4-3.7 2.2 2 2.4-2.6 2 2.3"/><circle cx="10" cy="8" r="1.4"/>'
      : '<path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4"/><path d="M9 12h6M9 15h6"/>';
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${path}</svg>`;
}

let scheduled = false;

function scheduleSync() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(() => {
    scheduled = false;
    syncMockupUi();
  });
}

function syncMockupUi() {
  const shell = document.querySelector<HTMLElement>(".folio-shell:not(.folio-empty-shell)");
  if (!shell) return;

  const bookIdentity = shell.querySelector<HTMLElement>(".book-identity");
  if (bookIdentity && !bookIdentity.querySelector(".book-more-button")) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "book-more-button";
    button.setAttribute("aria-label", "Book details");
    button.title = "Book details";
    button.textContent = "•••";
    button.addEventListener("click", () => {
      shell.querySelector<HTMLButtonElement>('[data-command="book"]')?.click();
    });
    bookIdentity.append(button);
  }

  const rows = shell.querySelectorAll<HTMLElement>(".contents-list .contents-row:not(.chapter-row)");
  rows.forEach((row) => {
    if (row.querySelector(".folio-nav-icon")) return;
    const icon = document.createElement("span");
    icon.className = "folio-nav-icon";
    icon.setAttribute("aria-hidden", "true");
    const label = (row.textContent ?? "").trim().toLowerCase();
    icon.innerHTML = svgIcon(row.classList.contains("cover-row") ? "cover" : label.includes("title") ? "book" : "page");
    row.prepend(icon);
  });

  const selectedChapter = shell.querySelector<HTMLElement>(".contents-list .chapter-row.selected");

  const status = shell.querySelector<HTMLElement>(".folio-statusbar");
  if (status) {
    let metrics = status.querySelector<HTMLElement>(".folio-status-metrics");
    if (!metrics) {
      metrics = document.createElement("span");
      metrics.className = "folio-status-metrics";
      const first = status.firstElementChild;
      if (first?.nextSibling) status.insertBefore(metrics, first.nextSibling);
      else status.append(metrics);
    }
    const chapterLabel = selectedChapter?.querySelector<HTMLElement>(".chapter-label")?.textContent?.trim() ?? "";
    const chapterNumber = selectedChapter?.querySelector<HTMLElement>(".chapter-number")?.textContent?.trim() ?? "";
    const words = shell.querySelector<HTMLElement>(".word-count")?.textContent?.trim() ?? "";
    metrics.textContent = [chapterNumber && `Chapter ${chapterNumber.replace(/\D/g, "")}`, chapterLabel, words].filter(Boolean).join("  ·  ");
  }
}

export function installMockupUiRuntime() {
  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  window.addEventListener("load", scheduleSync, { once: true });
  scheduleSync();
}
