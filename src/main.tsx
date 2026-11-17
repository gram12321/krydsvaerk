import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Tooltip } from "./Tooltip";
import "./style.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
    <Tooltip />
  </StrictMode>,
);
