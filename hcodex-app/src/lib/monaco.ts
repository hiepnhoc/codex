// Bundle Monaco locally (no CDN) and wire up its web workers for Vite.
import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import editorWorker from "monaco-editor/editor/editor.worker.js?worker";
import jsonWorker from "monaco-editor/language/json/json.worker.js?worker";
import cssWorker from "monaco-editor/language/css/css.worker.js?worker";
import htmlWorker from "monaco-editor/language/html/html.worker.js?worker";
import tsWorker from "monaco-editor/language/typescript/ts.worker.js?worker";

self.MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    switch (label) {
      case "json":
        return new jsonWorker();
      case "css":
      case "scss":
      case "less":
        return new cssWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new htmlWorker();
      case "typescript":
      case "javascript":
        return new tsWorker();
      default:
        return new editorWorker();
    }
  },
};

loader.config({ monaco });

// Same surfaces as the rest of the app (see lib/theme.ts), so the editor does not sit in a
// differently coloured box.
monaco.editor.defineTheme("hcodex-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: { "editor.background": "#15171a", "editorGutter.background": "#15171a", "editor.lineHighlightBackground": "#1d2025" },
});
monaco.editor.defineTheme("hcodex-light", {
  base: "vs",
  inherit: true,
  rules: [],
  colors: { "editor.background": "#ffffff", "editorGutter.background": "#ffffff", "editor.lineHighlightBackground": "#f4f5f7" },
});

export { monaco };
