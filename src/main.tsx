import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource-variable/lora/wght.css";
import "@fontsource-variable/fraunces/wght.css";
import "@fontsource-variable/space-grotesk/wght.css";
import "@fontsource-variable/oswald/wght.css";
import "@fontsource-variable/nunito/wght.css";
import "@fontsource-variable/caveat/wght.css";
import "@fontsource/outfit/latin-600.css";
import "./index.css";
import { initTheme } from "./ui/theme";

initTheme();

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
