import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { toolWindows } from "./tools";
import "./index.css";

// The main window has no hash; tool windows load #/<tool id>/<window name>.
const route = window.location.hash.replace(/^#\/?/, "");
const Root = route ? toolWindows[route] : App;

createRoot(document.getElementById("root")!).render(
  <StrictMode>{Root ? <Root /> : <p className="p-4 text-red-600">Unknown window: {route}</p>}</StrictMode>,
);
