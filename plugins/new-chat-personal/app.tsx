// bb-plugin-new-chat-personal - frontend entry.
//
// bb remembers the project of the last root composer (and the New thread
// shortcut picks the project of the thread in view), so the sidebar's
// New thread button often opens a chat inside some project. This plugin makes
// both the button and a replacement shortcut command always open a chat
// without a project. The + next to a project and the composer's project
// picker keep working as before.
import { useEffect } from "react";
import {
  definePluginApp,
  experimental_useSidebarThreadActions,
  type PluginSidebarThreadActions,
} from "@get-bb/plugin-sdk/app";

// bb's id for the "no project" scope.
const PERSONAL_PROJECT_ID = "proj_personal";
// Containers whose first button is bb's New thread: the sidebar header
// (bb >= 0.46), the collapsed nav rail (bb >= 0.46) and the navigation row
// (bb < 0.46).
const NEW_THREAD_ROW_SELECTOR = [
  '[data-testid="nav-rail-header"]',
  '[data-nav-rail-item="__bb__/new-thread"]',
  '[data-sidebar-navigation-item="__bb__/new-thread"]',
].join(",");

// Host action captured by the overlay; the shortcut command runs outside React.
let openNewThread: PluginSidebarThreadActions["openNewThread"] | null = null;

function openChatWithoutProject(): boolean {
  if (openNewThread === null) return false;
  openNewThread({ projectId: PERSONAL_PROJECT_ID, focusPrompt: true });
  return true;
}

function onClickCapture(event: MouseEvent): void {
  // Cmd/Ctrl+click opens New thread in a split; leave that and other
  // modified clicks to bb.
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest("button");
  const row = button?.closest(NEW_THREAD_ROW_SELECTOR);
  // The first button starts the thread; a row's other button opens its menu.
  if (button == null || row == null || row.querySelector("button") !== button) return;
  if (!openChatWithoutProject()) return;
  event.preventDefault();
  event.stopPropagation();
}

function NewChatRouter() {
  const actions = experimental_useSidebarThreadActions();

  useEffect(() => {
    const open = actions.openNewThread;
    openNewThread = open;
    return () => {
      if (openNewThread === open) openNewThread = null;
    };
  }, [actions]);

  useEffect(() => {
    // Capture phase on window runs before React's root listeners, so bb's own
    // handler never sees the click.
    window.addEventListener("click", onClickCapture, { capture: true });
    return () => window.removeEventListener("click", onClickCapture, { capture: true });
  }, []);

  return null;
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "new-chat-router", component: NewChatRouter });

  app.commands.register({
    id: "new-chat",
    title: "New chat without project",
    defaultShortcut: { key: "o", mod: true, shift: true },
    isAvailable: () => openNewThread !== null,
    run: () => {
      openChatWithoutProject();
    },
  });
});
