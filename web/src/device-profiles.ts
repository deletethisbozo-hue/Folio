\
export type PreviewFamily = "kindle" | "kobo" | "phone" | "tablet" | "print";

export type PreviewMode =
  | "kindle-6"
  | "kindle-6-8"
  | "kindle-7"
  | "kobo-6"
  | "kobo-7"
  | "kobo-8"
  | "phone-6-1"
  | "phone-6-7"
  | "tablet-8"
  | "tablet-11"
  | "tablet-13"
  | "print";

export type PreviewProfile = {
  value: PreviewMode;
  label: string;
  family: PreviewFamily;
  viewport: { width: number; height: number };
  baseFont: number;
  padding: [number, number, number, number];
  wordsPerPage: number;
  shellMaxWidth: number;
};

const profiles: PreviewProfile[] = [
  { value: "kindle-6", label: 'Kindle 6"', family: "kindle", viewport: { width: 400, height: 540 }, baseFont: 17.3, padding: [34, 16, 46, 16], wordsPerPage: 265, shellMaxWidth: 450 },
  { value: "kindle-6-8", label: 'Kindle 6.8"', family: "kindle", viewport: { width: 412, height: 549 }, baseFont: 17.5, padding: [34, 16, 46, 16], wordsPerPage: 270, shellMaxWidth: 475 },
  { value: "kindle-7", label: 'Kindle 7"', family: "kindle", viewport: { width: 421, height: 560 }, baseFont: 17.7, padding: [34, 20, 46, 20], wordsPerPage: 280, shellMaxWidth: 490 },
  { value: "kobo-6", label: 'Kobo 6"', family: "kobo", viewport: { width: 400, height: 540 }, baseFont: 17.3, padding: [32, 18, 44, 18], wordsPerPage: 265, shellMaxWidth: 450 },
  { value: "kobo-7", label: 'Kobo 7"', family: "kobo", viewport: { width: 421, height: 560 }, baseFont: 17.8, padding: [32, 24, 46, 24], wordsPerPage: 282, shellMaxWidth: 490 },
  { value: "kobo-8", label: 'Kobo 8"', family: "kobo", viewport: { width: 450, height: 600 }, baseFont: 18, padding: [38, 30, 52, 30], wordsPerPage: 320, shellMaxWidth: 520 },
  { value: "phone-6-1", label: 'Phone 6.1"', family: "phone", viewport: { width: 390, height: 844 }, baseFont: 18, padding: [38, 25, 58, 25], wordsPerPage: 245, shellMaxWidth: 315 },
  { value: "phone-6-7", label: 'Phone 6.7"', family: "phone", viewport: { width: 430, height: 932 }, baseFont: 18, padding: [42, 28, 64, 28], wordsPerPage: 285, shellMaxWidth: 340 },
  { value: "tablet-8", label: 'Tablet 8"', family: "tablet", viewport: { width: 744, height: 1133 }, baseFont: 18.5, padding: [52, 56, 72, 56], wordsPerPage: 390, shellMaxWidth: 470 },
  { value: "tablet-11", label: 'Tablet 11"', family: "tablet", viewport: { width: 820, height: 1180 }, baseFont: 19, padding: [62, 68, 82, 68], wordsPerPage: 455, shellMaxWidth: 520 },
  { value: "tablet-13", label: 'Tablet 13"', family: "tablet", viewport: { width: 1032, height: 1376 }, baseFont: 20, padding: [72, 84, 96, 84], wordsPerPage: 580, shellMaxWidth: 560 },
  { value: "print", label: "Print · Pages", family: "print", viewport: { width: 576, height: 864 }, baseFont: 16, padding: [0, 0, 0, 0], wordsPerPage: 0, shellMaxWidth: 480 },
];

export const previewProfiles = profiles;

export const previewProfileGroups: Array<{ label: string; profiles: PreviewProfile[] }> = [
  { label: "Kindle", profiles: profiles.filter((profile) => profile.family === "kindle") },
  { label: "Kobo", profiles: profiles.filter((profile) => profile.family === "kobo") },
  { label: "Phone", profiles: profiles.filter((profile) => profile.family === "phone") },
  { label: "Tablet", profiles: profiles.filter((profile) => profile.family === "tablet") },
  { label: "Print", profiles: profiles.filter((profile) => profile.family === "print") },
];

export function getPreviewProfile(value: string): PreviewProfile | undefined {
  return profiles.find((profile) => profile.value === value);
}
