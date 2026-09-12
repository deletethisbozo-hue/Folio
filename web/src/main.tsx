import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installPreviewRuntime } from "./preview-runtime";
import "./index.css";
import "./preview-calibration.css";
import "./editorial-studio.css";
import "./theme-fonts.css";

installPreviewRuntime();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
