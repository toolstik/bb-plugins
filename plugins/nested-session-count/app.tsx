import { definePluginApp, experimental_useSidebarThreads } from "@get-bb/plugin-sdk/app";
import { countChildren, countStyles } from "./counts";

function ChildCounts() {
  const { threads } = experimental_useSidebarThreads();
  return <style data-nested-session-count="">{countStyles(countChildren(threads))}</style>;
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "child-counts", component: ChildCounts });
});
