export interface PaperProfile { key: string; label: string; w: number; h: number; }
const metric = (key: string, label: string, w: number, h: number): PaperProfile => ({ key, label, w: w / 25.4, h: h / 25.4 });
export const PAPER_PROFILES: PaperProfile[] = [
  { key: "5x8", label: "5 × 8 in", w: 5, h: 8 },
  { key: "5.25x8", label: "5.25 × 8 in", w: 5.25, h: 8 },
  { key: "5.5x8.5", label: "5.5 × 8.5 in", w: 5.5, h: 8.5 },
  { key: "6x9", label: "6 × 9 in", w: 6, h: 9 },
  { key: "8.5x11", label: "Letter · 8.5 × 11 in", w: 8.5, h: 11 },
  metric("a5", "A5 · 148 × 210 mm", 148, 210),
  metric("a4", "A4 · 210 × 297 mm", 210, 297),
  metric("b5", "ISO B5 · 176 × 250 mm", 176, 250),
  metric("royal", "Royal · 156 × 234 mm", 156, 234),
  metric("crown", "Crown · 129 × 198 mm", 129, 198),
];
