function syncDuplicateLabels(root: ParentNode = document): void {
  const labels = Array.from(root.querySelectorAll<HTMLElement>(".contents-list .contents-row:not(.cover-row) .chapter-label, .contents-list .contents-row:not(.cover-row) > span:last-child"));
  const groups = new Map<string, HTMLElement[]>();

  for (const label of labels) {
    if (label.dataset.folioImagePageLabel === "true") continue;
    const current = (label.textContent ?? "").trim();
    let original = label.dataset.folioOriginalLabel?.trim() ?? "";
    if (!original || (current !== original && !current.startsWith(`${original} · `))) {
      original = current;
      label.dataset.folioOriginalLabel = original;
    }
    if (!original) continue;
    const key = original.toLocaleLowerCase();
    const group = groups.get(key) ?? [];
    group.push(label);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const original = group[0]?.dataset.folioOriginalLabel ?? "";
    group.forEach((label, index) => {
      const next = group.length > 1 && index > 0 ? `${original} · ${index + 1}` : original;
      if (label.textContent !== next) label.textContent = next;
      label.dataset.folioDisambiguated = group.length > 1 ? "true" : "false";
    });
  }
}

/** Section labels only. Image attributes must never lock an entire chapter. */
export function installSectionLabelsRuntime(): void {
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; syncDuplicateLabels(); });
  };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  schedule();
}
