import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { usageHostContract } from "./usage-contract.js";
import { budgetUsage } from "./src/budget.js";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { credentialHostContract } from "./credential-contract.js";
import { credentialStatus, saveCredential } from "./src/credential-store.js";
export { experimental_providerBridge } from "./src/bridge.js";
export default experimental_defineHostEntry({ contract: defineRpcContract({ ...credentialHostContract, ...usageHostContract }), handlers: {
  budgetUsage: (input, context) => budgetUsage(input, context.signal),
  credentialStatus: ({ path }) => credentialStatus(path),
  saveCredential: ({ path, apiKey }) => saveCredential(path, apiKey),
} });
