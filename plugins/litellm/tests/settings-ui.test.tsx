// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import appDefinition from "../app.js";
it("saves a masked key to the selected host and clears it from the form", async () => {
  const save = vi.fn(async () => ({ path: "/private/key.env", configured: true }));
  const app = await loadPluginApp(() => Promise.resolve({ default: appDefinition }));
  const slot = renderSlot(app.settingsSections[0]!, {}, { rpc: {
    credentialTargets: () => ({ hosts: [{ id: "host-a", name: "My Mac", connected: true }] }),
    credentialStatus: () => ({ path: "/private/key.env", configured: false }),
    saveCredential: save,
  } });
  await slot.findByText(/Ключ не настроен/);
  const input = slot.getByLabelText("API-ключ") as HTMLInputElement;
  expect(input.type).toBe("password");
  fireEvent.change(input, { target: { value: "fake-test-key" } });
  fireEvent.click(slot.getByText("Сохранить ключ"));
  await slot.findByText(/Ключ сохранен/);
  expect(save).toHaveBeenCalledWith({ hostId: "host-a", apiKey: "fake-test-key" });
  expect(input.value).toBe("");
  expect(slot.queryByText("fake-test-key")).toBeNull();
  slot.lifecycle.unmount();
});
