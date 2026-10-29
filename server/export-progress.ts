export interface ExportProgress {
  percent: number;
  stage: string;
  updatedAt: number;
}

const jobs = new Map<string, ExportProgress>();
const MAX_AGE_MS = 15 * 60_000;

function key(projectId: string, progressId: string): string {
  return `${projectId}:${progressId}`;
}

function prune(now: number): void {
  for (const [id, progress] of jobs) {
    if (now - progress.updatedAt > MAX_AGE_MS) jobs.delete(id);
  }
  while (jobs.size > 500) {
    const oldest = jobs.keys().next().value;
    if (oldest === undefined) break;
    jobs.delete(oldest);
  }
}

export function updateExportProgress(projectId: string, progressId: string | undefined, percent: number, stage: string): void {
  if (!progressId || !/^[\da-f-]{36}$/i.test(progressId)) return;
  const now = Date.now();
  prune(now);
  const id = key(projectId, progressId);
  const previous = jobs.get(id);
  jobs.set(key(projectId, progressId), {
    percent: Math.max(previous?.percent ?? 0, Math.max(0, Math.min(100, Math.round(percent)))),
    stage,
    updatedAt: now,
  });
}

export function readExportProgress(projectId: string, progressId: string): ExportProgress | null {
  prune(Date.now());
  return jobs.get(key(projectId, progressId)) ?? null;
}
