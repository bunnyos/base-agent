import { Buffer } from "buffer";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// @react-pdf/renderer (pdfkit/fontkit) expects Node's global Buffer, which the
// browser doesn't provide — without this polyfill PDF report generation throws
// "Buffer is not defined".
if (typeof globalThis.Buffer === "undefined") {
  globalThis.Buffer = Buffer;
}

createRoot(document.getElementById("root")!).render(<App />);
