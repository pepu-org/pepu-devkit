/**
 * pepu_generate_authorization_key
 *
 * WHAT: Generates the P-256 authorization key pair Privy session signers need,
 * using the SDK's `generatePrivyAuthorizationKey`, and writes the PRIVATE half
 * straight into the project's env file as PRIVY_AUTHORIZATION_KEY. Only the
 * PUBLIC key (plus a fingerprint) is returned to the model. The private key
 * never appears in tool output, logs or errors.
 *
 * SAFETY: confirmation-style arguments. Without `confirm_write: true` nothing
 * is generated or written; the tool describes what it would do. An existing
 * non-empty key is never replaced unless `overwrite: true` (replacing it
 * breaks every session granted under the old key's quorum). Only absolute
 * paths to `.env*` files are accepted.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { generatePrivyAuthorizationKey } from "@pepu-chain/sdk/doctor";
import { PRIVY_ENV } from "@pepu-chain/sdk/privy";
import { annotate } from "../annotations.js";
import { readEnvFile, upsertEnvFile } from "../env-file.js";
import { actionableError } from "../errors.js";
import { jsonResult } from "../format.js";
import { assertEnvFileName, assertExistingDirectory, assertSafeAbsolutePath } from "../safe-path.js";
import { sdkCall } from "../sdk-helpers.js";

const inputSchema = {
  envFile: z.string().describe("ABSOLUTE path of the project's env file, normally <project>/.env.local. Created if missing (the folder must exist). Must be named .env or .env.<something>."),
  confirm_write: z
    .boolean()
    .default(false)
    .describe("Must be true to generate a key and write it. When false the tool only reports what it would do, and writes nothing."),
  overwrite: z
    .boolean()
    .default(false)
    .describe(`Replace an existing non-empty ${PRIVY_ENV.authorizationKey}. Refused by default: replacing it invalidates sessions granted under the old key quorum.`),
};

export function registerGenerateAuthorizationKeyTool(server: McpServer): void {
  server.registerTool(
    "pepu_generate_authorization_key",
    {
      title: "Generate a Privy authorization key",
      description:
        "Generate the P-256 Privy authorization key for session signers with generatePrivyAuthorizationKey from @pepu-chain/sdk/doctor. The PRIVATE half is written straight to the env file as PRIVY_AUTHORIZATION_KEY and is never returned; only the PUBLIC key and a fingerprint come back, with the next dashboard step (register the public key as a key quorum, then set NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID). Requires confirm_write: true, an absolute .env path, and refuses to replace an existing key unless overwrite: true.",
      inputSchema,
      annotations: annotate({ readOnly: false, destructive: false, idempotent: false, openWorld: true }),
    },
    async ({ envFile, confirm_write, overwrite }) => {
      const resolved = assertSafeAbsolutePath(envFile, "envFile");
      assertEnvFileName(resolved, "envFile");
      assertExistingDirectory(path.dirname(resolved), "The folder containing envFile");
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        actionableError("envFile is a directory.", `${resolved} is a folder.`, "Pass the path to the .env.local file itself.");
      }

      const existing = readEnvFile(resolved)[PRIVY_ENV.authorizationKey];
      const hasExisting = typeof existing === "string" && existing.trim() !== "";

      if (hasExisting && !overwrite) {
        actionableError(
          `${PRIVY_ENV.authorizationKey} is already set in this file.`,
          "Replacing it would invalidate every session granted under the current key quorum, so it is refused.",
          "Keep the current key, or pass overwrite: true (with confirm_write: true) if you really mean to rotate it."
        );
      }

      if (!confirm_write) {
        return jsonResult({
          written: false,
          wouldDo: `Generate a P-256 key pair, write the private half to ${PRIVY_ENV.authorizationKey} in ${resolved}${hasExisting ? " (replacing the existing value)" : ""}, and return only the public key.`,
          next: "Call again with confirm_write: true to do it.",
        });
      }

      const pair = await sdkCall("generatePrivyAuthorizationKey", () => generatePrivyAuthorizationKey());
      upsertEnvFile(resolved, { [PRIVY_ENV.authorizationKey]: pair.privateKey });
      const fingerprint = createHash("sha256").update(pair.publicKey).digest("hex").slice(0, 16);

      return jsonResult({
        written: true,
        envFile: resolved,
        envKeyWritten: PRIVY_ENV.authorizationKey,
        privateKeyReturned: false,
        replacedExisting: hasExisting,
        publicKey: pair.publicKey,
        fingerprintSha256: fingerprint,
        nextSteps: [
          "In the Privy dashboard open Authorization keys (or Wallet infrastructure, Authorization), choose New key, and paste the public key above. Create a key quorum with threshold 1.",
          `Copy the key quorum id Privy returns into ${PRIVY_ENV.keyQuorumId} in the same env file.`,
          "Restart the dev server so the new env is read. Never commit the env file.",
          "Run pepu_check_env to confirm both keys are set (it reports presence and length only).",
        ],
        sdkFunction: "generatePrivyAuthorizationKey (@pepu-chain/sdk/doctor)",
      });
    }
  );
}
