import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const status = z.object({ path: z.string(), configured: z.boolean() }).strict();
const apiKey = z.string().min(1).max(8192).refine(value => !/[\s\x00-\x1f]/.test(value), "Enter a key without spaces or line breaks.");
export const credentialHostContract = defineRpcContract({
  credentialStatus: { input: z.object({ path: z.string().min(1) }).strict(), output: status },
  saveCredential: { input: z.object({ path: z.string().min(1), apiKey }).strict(), output: status },
});
export const credentialRpcContract = defineRpcContract({
  credentialTargets: { input: z.object({}).strict(), output: z.object({ hosts: z.array(z.object({ id: z.string(), name: z.string(), connected: z.boolean() }).strict()) }).strict() },
  credentialStatus: { input: z.object({ hostId: z.string().min(1) }).strict(), output: status },
  saveCredential: { input: z.object({ hostId: z.string().min(1), apiKey }).strict(), output: status },
});
