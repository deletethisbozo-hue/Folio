import { runWritingAnalysisJob, type WritingAnalysisJob } from "./analysis-job";
self.onmessage = (event: MessageEvent<WritingAnalysisJob>) => {
  try { self.postMessage({ result: runWritingAnalysisJob(event.data) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
