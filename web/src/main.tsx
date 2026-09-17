import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import StartScreen from "./StartScreen";
import { api } from "./api";
import type { ProjectSummary } from "./types";
import { installPreviewRuntime } from "./preview-runtime";
import { installRecentProjectTracking } from "./recent-projects";
import { installIllustrationControls } from "./illustration-controls";
import "./index.css";
import "./preview-calibration.css";
import "./editorial-studio.css";
import "./theme-fonts.css";
import "./start-screen.css";
import "./cover-workspace.css";
import "./image-page-workspace.css";
import "./ui-polish.css";
import "./v203-polish.css";
import "./v204-polish.css";
import "./pelagiad-branding.css";
import "./v205-coherence.css";

installPreviewRuntime();
installRecentProjectTracking(api);
installIllustrationControls();

function FolioRoot() {
  const [workspaceProject, setWorkspaceProject] = useState<ProjectSummary | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);

  function adoptProject(summary: ProjectSummary) {
    setWorkspaceProject(summary);
    setWorkspaceOpen(true);
  }

  async function openPath(path: string) {
    const clean = path.trim();
    if (!clean) return;
    const summary = await api.openFolder(clean);
    adoptProject(summary);
  }

  async function openSample() {
    const summary = await api.loadSample();
    const url = new URL(window.location.href);
    url.searchParams.delete("book");
    url.searchParams.set("sample", "1");
    window.history.replaceState(window.history.state, "", url);
    adoptProject(summary);
  }

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const book = params.get("book")?.trim();
    if (book) void openPath(book).catch(() => {});
    else if (params.get("sample") === "1") void openSample().catch(() => {});
  }, []);

  return workspaceOpen && workspaceProject
    ? <App initialProject={workspaceProject} />
    : <StartScreen onOpenPath={openPath} onOpenProject={adoptProject} onOpenSample={openSample} />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <FolioRoot />
  </React.StrictMode>
);
