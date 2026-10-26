import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyPaneWidths, ErrorBoundary } from "./ui";
import { initPush } from "./push";
import "./styles.css";

applyPaneWidths();
initPush();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
