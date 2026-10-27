// bb-plugin-new-chat-personal - backend entry.
//
// The plugin is frontend-only: an app overlay reroutes "New thread" to the
// personal project. bb requires a server entry, so this one only logs the load.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");
}
