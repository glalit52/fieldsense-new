import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import App from "./App.tsx";
import { I18nProvider } from "./lib/i18n.tsx";

createRoot(document.getElementById("root")!).render(<StrictMode><I18nProvider><App /></I18nProvider></StrictMode>);
