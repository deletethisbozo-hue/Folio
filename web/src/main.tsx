import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import StartScreen from "./StartScreen";
import { api } from "./api";
import type { ProjectSummary } from "./types";
import { installPreviewRuntime } from "./preview-runtime";
import { installRecentProjectTracking } from "./recent-projects";
import { installIllustrationControls } from "./illustration-controls";
import { installImagePageUiRuntime } from "./image-page-ui";
import { installMockupUiRuntime } from "./mockup-ui";
import "./index.css";
import "./preview-calibration.css";
import "./editorial-studio.css";
import "./theme-fonts.css";
import "./start-screen.css";
import "./cover-workspace.css";
import "./image-page-workspace.css";
import "./anchored-illustrations.css";
import "./ui-polish.css";
import "./v203-polish.css";
import "./v204-polish.css";
import "./v205-coherence.css";
import "./v206-correction.css";
import "./v207-preview.css";
import "./v207-mockup.css";
import "./v207-mockup-final.css";
import "./v210-writing-studio.css";

installPreviewRuntime();
installRecentProjectTracking(api);
installIllustrationControls();
installImagePageUiRuntime();
installMockupUiRuntime();

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
    const previousId = workspaceProject?.projectId ?? null;
    const summary = await api.openProjectFile(clean);
    if (previousId && previousId !== summary.projectId) await api.closeProject(previousId);
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

  function showDashboard() {
    const url = new URL(window.location.href);
    url.searchParams.delete("book");
    url.searchParams.delete("sample");
    window.history.replaceState(window.history.state, "", url);
    setWorkspaceProject(null);
    setWorkspaceOpen(false);
  }

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const book = params.get("book")?.trim();
    if (book) void openPath(book).catch(() => {});
    else if (params.get("sample") === "1") void openSample().catch(() => {});
  }, []);

  React.useEffect(() => {
    const host = window as Window & { __folioOpenProjectFile?: (projectPath: string) => Promise<boolean> };
    host.__folioOpenProjectFile = async (projectPath: string) => {
      try {
        await openPath(projectPath);
        const url = new URL(window.location.href);
        url.searchParams.delete("sample");
        url.searchParams.set("book", projectPath);
        window.history.replaceState(window.history.state, "", url);
        return true;
      } catch {
        return false;
      }
    };
    return () => { delete host.__folioOpenProjectFile; };
  }, [workspaceProject?.projectId]);

  return workspaceOpen && workspaceProject
    ? <App initialProject={workspaceProject} onDashboard={showDashboard} />
    : <StartScreen onOpenPath={openPath} onOpenProject={adoptProject} onOpenSample={openSample} />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <FolioRoot />
  </React.StrictMode>
);
