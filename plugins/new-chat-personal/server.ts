// bb-plugin-new-chat-personal - backend entry.
//
// The plugin is mostly frontend: an app overlay reroutes "New thread" to the
// personal project. The backend moves Cmd+Shift+O from bb's own New thread to
// the plugin's command, once per install: the plugin's default shortcut
// conflicts with bb's and would otherwise stay unbound. Later changes in
// Settings → Keyboard are the user's and are left alone.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

type Overrides = Parameters<BbPluginApi["sdk"]["system"]["updateKeyboardSettings"]>[0];

const SHORTCUTS: Overrides = [
  { command: "thread.new", shortcut: null },
  {
    command: "plugin:new-chat-personal/new-chat",
    shortcut: { key: "O", mod: true, shift: true, alt: false, control: false, meta: false },
  },
];

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  if ((await bb.storage.kv.get<boolean>("shortcutsApplied")) === true) return;
  try {
    const { keybindingOverrides } = await bb.sdk.system.config();
    const ours = new Set(SHORTCUTS.map((s) => s.command));
    const kept = keybindingOverrides.filter((o) => !(o.platform === undefined && ours.has(o.command)));
    await bb.sdk.system.updateKeyboardSettings([...kept, ...SHORTCUTS]);
    await bb.storage.kv.set("shortcutsApplied", true);
    bb.log.info("moved Cmd+Shift+O to New chat without project");
  } catch (cause) {
    bb.log.warn(`could not set shortcuts: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}
