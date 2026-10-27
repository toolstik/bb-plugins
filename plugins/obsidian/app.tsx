// bb-plugin-obsidian - frontend entry.
//
// bb renders a chat link to a local file as an anchor with a file:// href.
// A window-level capture listener sees the click before bb does: a link to a
// note of a registered Obsidian vault opens in Obsidian, every other click
// goes on to bb untouched, so other files keep their default viewer.
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";

/** Absolute path of a local Markdown file behind a file:// href, else null. */
function markdownPathFromHref(href: string): string | null {
  if (!href.startsWith("file://")) return null;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.host !== "") return null;
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  // file:///C:/... on Windows.
  if (/^\/[A-Za-z]:\//u.test(path)) path = path.slice(1);
  return path.toLowerCase().endsWith(".md") ? path : null;
}

function slashes(path: string): string {
  return path.replace(/\\/gu, "/").replace(/\/+$/u, "");
}

function isVaultNote(root: string, path: string): boolean {
  const r = slashes(root);
  const p = slashes(path);
  return p.startsWith(`${r}/`) && !p.startsWith(`${r}/.obsidian/`) && !p.split("/").includes("..");
}

function anchorOf(event: MouseEvent): HTMLAnchorElement | null {
  for (const node of event.composedPath()) {
    if (node instanceof HTMLAnchorElement && node.hasAttribute("href")) return node;
  }
  return null;
}

function ObsidianLinkInterceptor() {
  const rpc = useRpc<typeof rpcContract>();
  const roots = useRef<string[]>([]);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      rpc.call("list_vaults", null).then(
        ({ vaults }) => {
          if (alive) roots.current = vaults.map((v) => v.root);
        },
        () => {},
      );
    };
    refresh();
    // Vaults added in Obsidian show up after the bb window regains focus.
    window.addEventListener("focus", refresh);

    const onClick = (event: MouseEvent) => {
      // Modified clicks and the context menu stay with bb ("Open with" etc.).
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = anchorOf(event);
      const path = anchor && markdownPathFromHref(anchor.getAttribute("href") ?? "");
      if (!path || !roots.current.some((root) => isVaultNote(root, path))) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      rpc.call("open_in_obsidian", { path }).then(
        ({ opened, error }) => {
          if (!opened) toast.error(`Не удалось открыть в Obsidian: ${error ?? "неизвестная ошибка"}`);
        },
        (error: unknown) => toast.error(`Не удалось открыть в Obsidian: ${String(error)}`),
      );
    };
    window.addEventListener("click", onClick, true);

    return () => {
      alive = false;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("click", onClick, true);
    };
  }, [rpc]);

  return null;
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({
    id: "obsidian-link-interceptor",
    component: ObsidianLinkInterceptor,
  });
});
