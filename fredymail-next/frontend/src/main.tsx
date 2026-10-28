import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyPaneWidths, ErrorBoundary } from "./ui";
import { loadBrand } from "./brand";
import { initPush } from "./push";
import "./styles.css";

applyPaneWidths();
initPush();

loadBrand().finally(() => createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
));
