/**
 * Live proof of THIS template's session flow, with no browser and no Privy,
 * driven through the SDK: the same `createSponsoredSessionRoutes` config as
 * `lib/session-routes.ts` (only the auth is swapped for a throwaway owner).
 *
 *   PEPU_BUNDLER_URL=https://bundler.pepeunchained.com \
 *   PEPU_PAYMASTER_URL=https://paymaster.pepeunchained.com/v2/paymaster/<your-project-server-key> \
 *   npm run prove-session
 *
 * Sends REAL sponsored UserOperations on PEPU mainnet with random throwaway keys
 * that need no balance. The negative proofs (a different selector on the allowed
 * contract is refused by the chain, an expired grant is refused) are the SDK's
 * own script: `pnpm --filter @pepu-chain/sdk prove-session` in the devkit repo.
 */
import { getPublicClient, pepuMainnet } from "@pepu-chain/sdk";
import { createMemoryStore, createSponsoredSessionRoutes } from "@pepu-chain/sdk/combo";
import { approveKernelSession, buildKernelSessionPolicies, getKernelAddress } from "@pepu-chain/sdk/session/kernel";
import { formatEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { scope, TAPSCORE_ADDRESS } from "../lib/scope";
import { tapScoreAbi } from "../lib/tapscore";

const publicClient = getPublicClient(pepuMainnet);
const owner = privateKeyToAccount(generatePrivateKey());
const routes = createSponsoredSessionRoutes({
  scope,
  store: createMemoryStore(),
  publicClient,
  act: { parse: () => ({}), buildCalls: () => [{ to: TAPSCORE_ADDRESS, abi: tapScoreAbi, functionName: "tap" }] },
  authenticate: async () => ({ userId: "prove-session", ownerAddress: owner.address }),
});
const call = async (handler: (r: Request) => Promise<Response>, body?: unknown) => {
  const res = await handler(new Request("http://prove.local/", { method: body === undefined ? "GET" : "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const json = (await res.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
};

const kernel = await getKernelAddress(publicClient, owner.address);
console.log("owner (signer, throwaway):", owner.address, "\nkernel (sender)          :", kernel);

const prepared = await call(routes.prepare.POST, {});
const { approval } = await approveKernelSession({
  publicClient,
  owner,
  sessionKeyAddress: prepared.sessionKeyAddress,
  policies: buildKernelSessionPolicies({ calls: scope.calls, validUntil: prepared.validUntil }),
});
await call(routes.activate.POST, { approval });
for (let i = 1; i <= 2; i += 1) {
  const r = await call(routes.act.POST, {});
  console.log(`tap ${i}: success=${r.success} paymaster=${r.paymaster} gas=${formatEther(BigInt(r.actualGasCostWei))} PEPU\n       ${r.explorerUrl}`);
  if (!r.success) throw new Error("tap reverted");
}
const score = await publicClient.readContract({ address: TAPSCORE_ADDRESS, abi: tapScoreAbi, functionName: "scores", args: [kernel] });
const balance = await publicClient.getBalance({ address: kernel });
console.log(`scores(kernel)=${score} (expected 2), kernel balance=${formatEther(balance)} PEPU (expected 0)`);
await call(routes.revoke.POST, {});
if ((await call(routes.status.GET)).active) throw new Error("still active after revoke");
if (score !== 2n || balance !== 0n) throw new Error("UNEXPECTED score or balance");
console.log("PROOF COMPLETE");
