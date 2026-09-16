import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import StartScreen from "./StartScreen";
import { api } from "./api";
import { installPreviewRuntime } from "./preview-runtime";
import { installRecentProjectTracking } from "./recent-projects";
import "./index.css";
import "./preview-calibration.css";
import "./editorial-studio.css";
import "./theme-fonts.css";
import "./start-screen.css";

installPreviewRuntime();
installRecentProjectTracking(api);

function FolioRoot() {
  const [workspaceOpen, setWorkspaceOpen] = useState(() => Boolean(new URLSearchParams(window.location.search).get("book")?.trim()));

  function openPath(path: string) {
    const clean = path.trim();
    if (!clean) return;
    const url = new URL(window.location.href);
    url.searchParams.set("book", clean);
    window.history.replaceState(window.history.state, "", url);
    setWorkspaceOpen(true);
  }

  return workspaceOpen ? <App /> : <StartScreen onOpenPath={openPath} />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <FolioRoot />
  </React.StrictMode>
);
