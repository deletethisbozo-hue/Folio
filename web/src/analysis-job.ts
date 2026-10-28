import { analyzeWritingSnapshot, markdownToReadableSnapshotText } from "./write-studio";

export interface WritingAnalysisJob { markdown: string; language: string; windowWords: number; documents?: string[]; }
export type WritingAnalysisResult = NonNullable<ReturnType<typeof analyzeWritingSnapshot>>;
export function runWritingAnalysisJob(job: WritingAnalysisJob): WritingAnalysisResult {
  // Keep neighbouring-word scans from joining the end/start of two chapters.
  const separator = Array.from({ length: Math.max(200, Math.min(500, Math.round(job.windowWords) || 80)) + 16 }, (_, index) => String(1000000 + index)).join(" ");
  const text = job.documents ? job.documents.map(markdownToReadableSnapshotText).join("\n\n" + separator + "\n\n") : markdownToReadableSnapshotText(job.markdown);
  return analyzeWritingSnapshot(true, () => text, job.language, job.windowWords)!;
}
