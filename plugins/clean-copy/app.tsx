// bb-plugin-clean-copy - frontend entry.
//
// When text is copied from the bb window, the browser puts HTML on the
// clipboard with the computed colors, backgrounds and fonts inlined, so a
// paste into Docs, Notion, Word or mail brings the app theme along. This
// content script replaces that HTML with a clean copy of the selection:
// structure (paragraphs, headings, lists, bold, italic, links, tables, code)
// stays, every style, class, color and font attribute goes.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { cleanSelectionHtml } from "./clean";

// Places that own their own copy behavior or where rich text makes no sense.
const SKIP_SELECTOR = [
  "input",
  "textarea",
  "[contenteditable]:not([contenteditable='false'])",
  ".xterm",
  ".monaco-editor",
  ".cm-editor",
].join(",");

function closestElement(node: Node | null): Element | null {
  if (node === null) return null;
  return node instanceof Element ? node : node.parentElement;
}

function onCopy(event: ClipboardEvent): void {
  if (event.defaultPrevented || event.clipboardData === null) return;
  const selection = document.getSelection();
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return;
  for (let i = 0; i < selection.rangeCount; i++) {
    const container = closestElement(selection.getRangeAt(i).commonAncestorContainer);
    if (container === null || container.closest(SKIP_SELECTOR) !== null) return;
  }

  const html = cleanSelectionHtml(selection);
  if (html.trim() === "") return;
  event.clipboardData.setData("text/html", html);
  event.clipboardData.setData("text/plain", selection.toString());
  event.preventDefault();
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "clean-copy",
    mount({ signal }) {
      // Capture phase on window: runs before any app handler can stop the
      // event; editors and terminals are excluded by SKIP_SELECTOR instead.
      window.addEventListener("copy", onCopy, { capture: true, signal });
    },
  });
});
