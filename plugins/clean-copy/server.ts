// bb-plugin-clean-copy - backend entry.
//
// Clean copy is frontend-only: a content script rewrites the clipboard on
// copy. bb requires a server entry, so this one only logs the load.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");
}
