import { useEffect, useRef, useState } from "react";
import type { PreflightReport } from "../types";

export default function PublishPreflight(props: {
  onRun: (format: "epub" | "print") => Promise<PreflightReport>;
  onClose: () => void;
  onSection: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function check(format: "epub" | "print") {
    setBusy(true); setError(""); setReport(null);
    try { setReport(await props.onRun(format)); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="publish-preflight-panel" onCancel={(event) => { event.preventDefault(); if (!busy) props.onClose(); }} role="dialog" aria-modal="true" aria-labelledby="preflight-title">
      <header><h2 id="preflight-title">Publish Preflight</h2><button className="native-button" disabled={busy} onClick={props.onClose} aria-label="Close Publish Preflight">Close</button></header>
      <p>Check the saved manuscript for missing resources, broken internal links and publishing settings. EPUBCheck also validates every exported EPUB.</p>
      <div className="publish-preflight-actions"><button className="native-button" disabled={busy} onClick={() => void check("epub")}>Check EPUB</button><button className="native-button" disabled={busy} onClick={() => void check("print")}>Check Print PDF</button></div>
      <div role="status" aria-live="polite">{busy ? "Checking the whole book…" : error || (report ? report.ready ? "No blocking problems found." : "Resolve these errors before exporting." : "Choose an output to check.")}</div>
      {report && <ul className="publish-preflight-issues">{report.issues.map((issue, index) => <li key={index} data-severity={issue.severity}><strong>{issue.severity === "error" ? "Error" : "Warning"}: {issue.text}</strong><p>{issue.remedy}</p>{issue.sectionId && <button className="native-button" onClick={() => { props.onSection(issue.sectionId!); props.onClose(); }}>Open section</button>}</li>)}</ul>}
  </dialog>;
}
