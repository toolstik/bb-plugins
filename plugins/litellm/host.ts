import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { credentialHostContract } from "./credential-contract.js";
import { credentialStatus, saveCredential } from "./src/credential-store.js";
export { experimental_providerBridge } from "./src/bridge.js";
export default experimental_defineHostEntry({ contract: credentialHostContract, handlers: {
  credentialStatus: ({ path }) => credentialStatus(path),
  saveCredential: ({ path, apiKey }) => saveCredential(path, apiKey),
} });
