import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installPreviewRuntime } from "./preview-runtime";
import "./index.css";
import "./preview-calibration.css";

installPreviewRuntime();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
