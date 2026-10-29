import type { ThemeLibraryEntry } from "./types";

export interface ThemeCollection {
  id: string;
  label: string;
  count: number;
}

const collectionRules: Array<{ id: string; label: string; matches: (theme: ThemeLibraryEntry) => boolean }> = [
  {
    id: "illustrated",
    label: "Illustrated",
    matches: ({ config }) => Boolean(config.chapterOrnament?.dataUrl || config.sceneImage?.dataUrl),
  },
  {
    id: "typography",
    label: "Typography-led",
    matches: ({ config }) => Boolean(config.bodyFont || config.headingFont || config.titlePageFont || (config.headingSize ?? 0) >= 2.2),
  },
  {
    id: "ornamental",
    label: "Ornamental",
    matches: ({ config }) => Boolean(
      (config.dropcap ?? false)
      || (config.chapterRule && config.chapterRule !== "none")
      || (config.sceneOrnament && config.sceneOrnament !== "⁂"),
    ),
  },
  {
    id: "minimal",
    label: "Minimal",
    matches: ({ config }) => !config.chapterOrnament?.dataUrl
      && !config.sceneImage?.dataUrl
      && !config.dropcap
      && (!config.chapterRule || config.chapterRule === "none"),
  },
];

export function themeCollections(themes: ThemeLibraryEntry[]): ThemeCollection[] {
  return [
    { id: "all", label: "All saved themes", count: themes.length },
    ...collectionRules
      .map(({ id, label, matches }) => ({ id, label, count: themes.filter(matches).length }))
      .filter((collection) => collection.count > 0),
  ];
}

export function themeMatchesCollection(theme: ThemeLibraryEntry, collectionId: string): boolean {
  if (collectionId === "all") return true;
  return collectionRules.find((collection) => collection.id === collectionId)?.matches(theme) ?? false;
}
