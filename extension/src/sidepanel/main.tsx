import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { I18nProvider } from "@/i18n/react";
import "./index.css";
import { readActiveProjectId, setProjectResolver } from "@/features/projects/scope";

// A panel works in the project that was active when it opened, for life: switching reloads every
// panel (App.tsx), and until that reload lands nothing of this one may read or write the new one's.
void readActiveProjectId().then((projectId) => {
  setProjectResolver(() => projectId);
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <I18nProvider>
        <App />
      </I18nProvider>
    </React.StrictMode>,
  );
});
