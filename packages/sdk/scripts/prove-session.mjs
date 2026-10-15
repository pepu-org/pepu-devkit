/**
 * Live proof of the SDK's Kernel session flow with NO browser and NO Privy.
 * Mirrors templates/sponsored-session-app/scripts/prove-session.ts but drives
 * it through the SDK: `@pepu-chain/sdk/combo` route factories (prepare,
 * activate, status, act, revoke) plus `@pepu-chain/sdk/session/kernel`.
 *
 *   throwaway owner key   -> signs ONE enable message (the grant)
 *   throwaway session key -> generated and held by the route's in-memory store
 *   paymaster             -> pays the gas (the Kernel account holds 0 PEPU)
 *
 * It also tries two things the session must NOT be able to do and expects the
 * chain or bundler to refuse them: a function outside the call policy, and any
 * call after the session expired.
 *
 * Needs a running bundler and paymaster (local dev: localhost:4337 and
 * localhost:8788). Build first (`pnpm build`), then:
 *
 *   node --env-file=path/to/.env.local scripts/prove-session.mjs
 *
 * with PEPU_BUNDLER_URL and PEPU_PAYMASTER_URL set (secrets are never printed).
 * Sends REAL sponsored UserOperations on PEPU mainnet (a few PEPU of the
 * paymaster deposit). Owner and session keys are random per run, never stored.
 */
import { createPublicClient, formatEther, http, parseAbi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const { pepuMainnet } = await import("../dist/index.js");
const { createSponsoredSessionRoutes, createMemoryStore } = await import("../dist/combo.js");
const {
  approveKernelSession,
  buildKernelSessionPolicies,
  generateSessionKey,
  getKernelAddress,
  loadKernelSessionAccount,
} = await import("../dist/session/kernel.js");
const { createPepuSponsoredClient } = await import("../dist/aa/kernel.js");

const bundlerUrl = process.env.PEPU_BUNDLER_URL?.trim() || "http://localhost:4337";
const paymasterUrl = process.env.PEPU_PAYMASTER_URL?.trim();
if (!paymasterUrl) {
  console.error("Set PEPU_PAYMASTER_URL (local dev: http://localhost:8788/paymaster/<your-app-key>).");
  process.exit(1);
}
const paymasterContract = process.env.PAYMASTER_CONTRACT_ADDRESS?.trim() || "0x2B6FED323bFA24f0475f4e1Dd3C7F6Cc1f3ae8B0";
const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const TAPSCORE = "0x261eA5971B93237a56990206A46Bc80318e4d078";
const tapScoreAbi = parseAbi([
  "function tap()",
  "function scores(address player) view returns (uint256)",
]);

const publicClient = createPublicClient({ chain: pepuMainnet, transport: http() });
const deposit = () =>
  publicClient.readContract({
    address: ENTRY_POINT,
    abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
    functionName: "balanceOf",
    args: [paymasterContract],
  });
const firstLine = (e) => String(e instanceof Error ? e.message : e).split("\n")[0].slice(0, 200);

const owner = privateKeyToAccount(generatePrivateKey());
const kernelAddress = await getKernelAddress(publicClient, owner.address);
console.log("owner (signer, throwaway):", owner.address);
console.log("kernel (sender)          :", kernelAddress);
console.log("kernel balance (PEPU)    :", formatEther(await publicClient.getBalance({ address: kernelAddress })));

const scope = { calls: [{ target: TAPSCORE, abi: tapScoreAbi, functionName: "tap" }] };
const routes = createSponsoredSessionRoutes({
  scope,
  store: createMemoryStore(),
  minutes: 15,
  endpoints: { bundlerUrl, paymasterUrl },
  publicClient,
  act: {
    parse: () => ({}),
    buildCalls: () => [{ to: TAPSCORE, abi: tapScoreAbi, functionName: "tap" }],
  },
  authenticate: async () => ({ userId: "prove-session", ownerAddress: owner.address }),
});
const req = (body) => new Request("http://prove.local/x", { method: "POST", body: body ? JSON.stringify(body) : undefined });
const ok = async (res, label) => {
  const body = await res.json();
  if (!res.ok) throw new Error(`${label} failed (${res.status}): ${JSON.stringify(body.error ?? body).slice(0, 300)}`);
  return body;
};

// 1. prepare (server picks the session key), then the ONE owner signature, then activate.
const prepared = await ok(await routes.prepare.POST(req()), "prepare");
if (prepared.kernelAddress !== kernelAddress) throw new Error("kernel address changed between prepare and read");
const { approval } = await approveKernelSession({
  publicClient,
  owner,
  sessionKeyAddress: prepared.sessionKeyAddress,
  policies: buildKernelSessionPolicies({ calls: scope.calls, validUntil: prepared.validUntil }),
});
await ok(await routes.activate.POST(req({ approval })), "activate");
console.log(`grant signed (${approval.length} chars), validUntil ${prepared.validUntil}, session key ${prepared.sessionKeyAddress}`);

// 2. Sponsored taps by the session key alone (first also deploys the account and enables the permission).
const before = await deposit();
for (let i = 1; i <= 2; i += 1) {
  const r = await ok(await routes.act.POST(req({})), `act ${i}`);
  console.log(`act ${i}: success=${r.success} userOp=${r.userOpHash} paymaster=${r.paymaster} gas=${formatEther(BigInt(r.actualGasCostWei))} PEPU`);
  console.log(`       tx ${r.explorerUrl}`);
  if (!r.success) throw new Error("act reverted");
}
const after = await deposit();
const score = await publicClient.readContract({ address: TAPSCORE, abi: tapScoreAbi, functionName: "scores", args: [kernelAddress] });
console.log("TapScore.scores(kernel)  :", score.toString(), "(expected 2)");
console.log("kernel balance after     :", formatEther(await publicClient.getBalance({ address: kernelAddress })), "PEPU (expected 0)");
console.log("paymaster deposit drop   :", formatEther(before - after), "PEPU");
const status = await ok(await routes.status.GET(new Request("http://prove.local/s")), "status");
console.log("status                   :", JSON.stringify({ active: status.active, actions: status.actions }));
if (String(score) !== "2" || status.actions !== 2) throw new Error("UNEXPECTED: score or action count");

// 3. Negative: a different selector on the allowed contract must be refused.
const keyAndApproval = async (validUntil) => {
  const key = generateSessionKey();
  const { approval: a } = await approveKernelSession({
    publicClient,
    owner,
    sessionKeyAddress: key.address,
    policies: buildKernelSessionPolicies({ calls: scope.calls, validUntil }),
  });
  return { key, approval: a };
};
const clientFor = async (key, a) => {
  const account = await loadKernelSessionAccount({ publicClient, approval: a, sessionPrivateKey: key.privateKey });
  return { account, client: createPepuSponsoredClient({ account, publicClient, bundlerUrl, paymasterUrl }) };
};
{
  const { key, approval: a } = await keyAndApproval(Math.floor(Date.now() / 1000) + 900);
  const { account, client } = await clientFor(key, a);
  try {
    await client.sendUserOperation({
      callData: await account.encodeCalls([
        { to: TAPSCORE, value: 0n, data: (await import("viem")).encodeFunctionData({ abi: tapScoreAbi, functionName: "scores", args: [owner.address] }) },
      ]),
    });
    throw new Error("UNEXPECTED: out-of-scope call was accepted");
  } catch (e) {
    if (String(e?.message).startsWith("UNEXPECTED")) throw e;
    console.log("out-of-scope selector refused:", firstLine(e));
  }
}

// 4. Negative: an already-expired session must be refused.
{
  const { key, approval: a } = await keyAndApproval(Math.floor(Date.now() / 1000) - 60);
  const { account, client } = await clientFor(key, a);
  try {
    await client.sendUserOperation({
      callData: await account.encodeCalls([
        { to: TAPSCORE, value: 0n, data: (await import("viem")).encodeFunctionData({ abi: tapScoreAbi, functionName: "tap" }) },
      ]),
    });
    throw new Error("UNEXPECTED: expired session was accepted");
  } catch (e) {
    if (String(e?.message).startsWith("UNEXPECTED")) throw e;
    console.log("expired session refused      :", firstLine(e));
  }
}

// 5. Revoke deletes the server key immediately.
await ok(await routes.revoke.POST(req()), "revoke");
const after2 = await ok(await routes.status.GET(new Request("http://prove.local/s")), "status");
if (after2.active) throw new Error("UNEXPECTED: still active after revoke");
const refused = await routes.act.POST(req({}));
console.log("act after revoke         :", refused.status, "(expected 409)");
if (refused.status !== 409) throw new Error("UNEXPECTED: act accepted after revoke");
console.log("PROOF COMPLETE");
