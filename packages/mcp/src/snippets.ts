/**
 * Curated SDK snippets served by pepu_sdk_snippet: one per pillar and per
 * useful combination. Each uses ONLY @pepu-chain/sdk functions, never hand-rolled
 * infrastructure. snippets.test.ts parses every import and checks each imported
 * name exists in the bundled SDK export list, so a renamed SDK export fails the
 * test instead of silently serving dead code.
 *
 * Pillars: login (Privy login and embedded wallet), session (Privy or Kernel
 * session keys), sponsorship (bundler and paymaster). Combinations: the
 * sponsored session.
 */

export type SnippetPillar = "login" | "wallet" | "session" | "sponsorship" | "chain" | "paymaster-v2" | "combo";

export interface Snippet {
  id: string;
  title: string;
  pillars: SnippetPillar[];
  /** Where the code goes in a Next.js App Router project. */
  file: string;
  /** Packages the code needs beyond the SDK itself. */
  peers: string[];
  env: string[];
  notes: string[];
  code: string;
}

const PRIVY_ENV = ["NEXT_PUBLIC_PRIVY_APP_ID", "PRIVY_APP_SECRET"];
const SPONSOR_ENV = ["PEPU_BUNDLER_URL", "PEPU_PAYMASTER_URL"];
const PUBLIC_ENDPOINTS_NOTE = "Hosted endpoints are live: the bundler defaults to https://bundler.pepeunchained.com; set PEPU_PAYMASTER_URL to https://paymaster.pepeunchained.com/v2/paymaster/<token> (project client token from allowed origins, project server key on a backend, or a free-tier app token with the user's Privy access token as context).";

export const SNIPPETS: readonly Snippet[] = [
  {
    id: "privy-provider",
    title: "Privy provider preconfigured for PEPU, with the wallet gate",
    pillars: ["login", "wallet"],
    file: "app/providers.tsx",
    peers: ["@privy-io/react-auth", "react"],
    env: ["NEXT_PUBLIC_PRIVY_APP_ID"],
    notes: [
      "PepuPrivyProvider pins PEPU mainnet only, Coinbase to eoaOnly, and turns client-side wallet creation off: the server provisions the wallet (see ensure-wallet-route).",
      "Add the exact origin with port (http://localhost:3000) to Privy dashboard Allowed origins. Verify with pepu_check_privy_config.",
    ],
    code: `"use client";
import type { ReactNode } from "react";
import { PepuPrivyProvider, WalletGate } from "@pepu-chain/sdk/privy/react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <PepuPrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID}
      config={{ loginMethods: ["email", "google"] }}
    >
      {/* WalletGate provisions the embedded wallet through /api/wallet/ensure, then renders children */}
      <WalletGate>{children}</WalletGate>
    </PepuPrivyProvider>
  );
}
`,
  },
  {
    id: "ensure-wallet-route",
    title: "Server route that provisions the embedded wallet",
    pillars: ["login", "wallet"],
    file: "app/api/wallet/ensure/route.ts",
    peers: ["@privy-io/node"],
    env: PRIVY_ENV,
    notes: [
      "The user id comes only from the verified access token. The route is idempotent: a double submit never makes a second wallet.",
      "Needed because the Privy dashboard's create-on-login setting wins over createOnLogin in code.",
    ],
    code: `import { createEnsureWalletRoute } from "@pepu-chain/sdk/privy/server";

export const { POST } = createEnsureWalletRoute();
`,
  },
  {
    id: "wagmi-privy",
    title: "wagmi on PEPU with the Privy embedded wallet pinned as the active account",
    pillars: ["login", "wallet"],
    file: "app/providers.tsx",
    peers: ["@privy-io/react-auth", "@privy-io/wagmi", "wagmi", "@tanstack/react-query"],
    env: ["NEXT_PUBLIC_PRIVY_APP_ID"],
    notes: ["Pins the embedded wallet so a browser extension never becomes the active wagmi account. The /privy/wagmi entry is ESM only."],
    code: `"use client";
import type { ReactNode } from "react";
import { PepuPrivyWagmiProvider } from "@pepu-chain/sdk/privy/wagmi";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <PepuPrivyWagmiProvider appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID}>
      {children}
    </PepuPrivyWagmiProvider>
  );
}
`,
  },
  {
    id: "grant-session",
    title: "Privy session mode: grant, act and revoke from a component",
    pillars: ["session", "login"],
    file: "components/session-panel.tsx",
    peers: ["@privy-io/react-auth", "react"],
    env: [],
    notes: [
      "Privy mode: the scope is enforced by Privy's backend policy engine, not on-chain, and the user pays gas. Show SESSION_TRUST_NOTICE['privy-offchain'] on the consent screen.",
      "Needs the routes from session-routes and session-action-route.",
    ],
    code: `"use client";
import { useSessionGrant, useSessionStatus, useSessionAct } from "@pepu-chain/sdk/session/react";

export function SessionPanel() {
  const { grant, status: grantStatus, error } = useSessionGrant();
  const { state, secondsLeft } = useSessionStatus({ pollMs: 30_000 });
  const { act, status } = useSessionAct<Record<string, never>, { hash: string }>({ endpoint: "/api/game/tap" });

  if (state !== "active") {
    return <button onClick={grant} disabled={grantStatus === "creating-policy"}>Start a session</button>;
  }
  return (
    <button onClick={() => act({})} disabled={status === "pending"}>
      Tap ({secondsLeft}s left)
    </button>
  );
}
`,
  },
  {
    id: "session-routes",
    title: "Privy session mode: grant, status and revoke routes",
    pillars: ["session"],
    file: "lib/session-routes.ts",
    peers: ["@privy-io/node"],
    env: [...PRIVY_ENV, "NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID", "PRIVY_AUTHORIZATION_KEY"],
    notes: [
      "Generate the authorization key with pepu_generate_authorization_key; it writes the private half to .env.local and returns only the public key.",
      "Create the three route files, each re-exporting one handler: app/api/session/grant/route.ts exports routes.grant.POST, status exports routes.status.GET, revoke exports routes.revoke.POST.",
    ],
    code: `import { createSessionRoutes } from "@pepu-chain/sdk/session/server";
import { tapAbi, TAP_CONTRACT } from "./contract";

export const routes = createSessionRoutes({
  scope: { contractAddress: TAP_CONTRACT, functions: [tapAbi] },
  minutes: 15,
});

// app/api/session/grant/route.ts:   export const { POST } = routes.grant;
// app/api/session/status/route.ts:  export const { GET } = routes.status;
// app/api/session/revoke/route.ts:  export const { POST } = routes.revoke;
`,
  },
  {
    id: "session-action-route",
    title: "Privy session mode: the route that acts with the session",
    pillars: ["session"],
    file: "app/api/game/tap/route.ts",
    peers: ["@privy-io/node"],
    env: [...PRIVY_ENV, "PRIVY_AUTHORIZATION_KEY"],
    notes: [
      "Signs with eth_signTransaction and broadcasts itself, because Privy rejects server-side eth_sendTransaction on chain 97741.",
      "409 SESSION_NONE is the only 'no session' signal; any other failure is a failed transaction, not a lost session.",
    ],
    code: `import { createSessionActionRoute } from "@pepu-chain/sdk/session/server";
import { tapAbi, TAP_CONTRACT } from "@/lib/contract";

export const { POST } = createSessionActionRoute({
  scope: { contractAddress: TAP_CONTRACT, functions: [tapAbi] },
  parse: () => ({}),
  buildCall: () => ({ to: TAP_CONTRACT, abi: [tapAbi], functionName: "tap" }),
  rateLimit: { perMinute: 60 },
});
`,
  },
  {
    id: "kernel-session-policy",
    title: "Kernel session mode: on-chain session scope for a consent screen",
    pillars: ["session", "combo"],
    file: "lib/session-scope.ts",
    peers: ["@zerodev/sdk", "@zerodev/permissions", "@zerodev/ecdsa-validator"],
    env: [],
    notes: [
      "Kernel mode: call policy v0.0.4 plus a timestamp policy, enforced on-chain by the user's smart account. Show SESSION_TRUST_NOTICE['kernel-onchain'].",
      "pepu_session_policy builds the same data for you with a chosen contract and functions.",
    ],
    code: `import { describeKernelSessionScope, buildKernelSessionPolicies } from "@pepu-chain/sdk/session/kernel";
import { SESSION_TRUST_NOTICE } from "@pepu-chain/sdk/session";
import { tapScoreAbi, TAP_SCORE } from "./contract";

const validUntil = Math.floor(Date.now() / 1000) + 15 * 60;
const calls = [{ target: TAP_SCORE, abi: tapScoreAbi, functionName: "tap" }];

export const scope = describeKernelSessionScope({ calls, validUntil }); // signature, selector, value limit, expiry
export const policies = buildKernelSessionPolicies({ calls, validUntil });
export const notice = SESSION_TRUST_NOTICE["kernel-onchain"];
`,
  },
  {
    id: "sponsored-send",
    title: "Sponsorship: send a gasless transaction from a component",
    pillars: ["sponsorship", "login"],
    file: "components/sponsored-tap.tsx",
    peers: ["@privy-io/react-auth", "@zerodev/sdk", "@zerodev/ecdsa-validator", "react"],
    env: ["NEXT_PUBLIC_PRIVY_APP_ID", "NEXT_PUBLIC_PEPU_BUNDLER_URL", "NEXT_PUBLIC_PEPU_PAYMASTER_URL"],
    notes: [
      PUBLIC_ENDPOINTS_NOTE,
      "useDirectSponsoredSend (from /aa/react-direct) builds a Kernel account for the embedded wallet and sends through your bundler and paymaster, passing the Privy access token for the free tier. For Privy Smart Wallets (dashboard URLs, no ZeroDev, needs permissionless) use useSponsoredSend from /aa/react instead.",
      "Check the stack first with pepu_sponsorship_status.",
    ],
    code: `"use client";
import { usePepuSponsorship } from "@pepu-chain/sdk/aa/react";
import { useDirectSponsoredSend } from "@pepu-chain/sdk/aa/react-direct";
import { tapScoreAbi, TAP_SCORE } from "@/lib/contract";

export function SponsoredTap() {
  const sponsorship = usePepuSponsorship({ pollMs: 15_000 });
  const { send, status, result, error } = useDirectSponsoredSend();

  if (!sponsorship.loading && !sponsorship.available) return <p>{sponsorship.reason}</p>;
  return (
    <>
      <button onClick={() => send([{ to: TAP_SCORE, abi: tapScoreAbi, functionName: "tap" }])} disabled={status === "submitting"}>
        Tap, no gas
      </button>
      {result && <a href={result.explorerUrl}>paid by {result.paymaster ?? "the account"}</a>}
      {error && <p>{error.message} {error.hint}</p>}
    </>
  );
}
`,
  },
  {
    id: "sponsored-send-server",
    title: "Sponsorship: send a sponsored UserOperation from a script or route",
    pillars: ["sponsorship"],
    file: "scripts/sponsored-tap.ts",
    peers: ["@zerodev/sdk", "@zerodev/ecdsa-validator"],
    env: SPONSOR_ENV,
    notes: [PUBLIC_ENDPOINTS_NOTE, "sendSponsored maps AAxx failures and paymaster denials to typed PepuErrors with a hint."],
    code: `import { getPublicClient, pepuMainnet } from "@pepu-chain/sdk";
import { toPepuKernelAccount, createPepuSponsoredClient, sendSponsored } from "@pepu-chain/sdk/aa/kernel";
import { privateKeyToAccount } from "viem/accounts";
import { tapScoreAbi, TAP_SCORE } from "./contract";

const publicClient = getPublicClient(pepuMainnet);
const account = await toPepuKernelAccount({ publicClient, owner: privateKeyToAccount(process.env.OWNER_KEY as \`0x\${string}\`) });
const client = createPepuSponsoredClient({ account, publicClient }); // bundler and paymaster from PEPU_BUNDLER_URL / PEPU_PAYMASTER_URL

const r = await sendSponsored({ client, calls: [{ to: TAP_SCORE, abi: tapScoreAbi, functionName: "tap" }] });
console.log(r.success, r.paymaster, r.explorerUrl);
`,
  },
  {
    id: "check-sponsorship",
    title: "Sponsorship: is it available right now?",
    pillars: ["sponsorship"],
    file: "scripts/check-sponsorship.ts",
    peers: [],
    env: SPONSOR_ENV,
    notes: [PUBLIC_ENDPOINTS_NOTE],
    code: `import { checkSponsorship, getPublicClient, pepuMainnet } from "@pepu-chain/sdk";

const s = await checkSponsorship({ publicClient: getPublicClient(pepuMainnet) });
if (!s.available) console.log(s.reason, s.fixes);
`,
  },
  {
    id: "sponsored-session",
    title: "Sponsored session: Kernel session key plus paymaster, five routes",
    pillars: ["combo", "session", "sponsorship"],
    file: "lib/session-routes.ts",
    peers: ["@privy-io/node", "@zerodev/sdk", "@zerodev/permissions", "@zerodev/ecdsa-validator"],
    env: [...PRIVY_ENV, ...SPONSOR_ENV],
    notes: [
      PUBLIC_ENDPOINTS_NOTE,
      "createMemoryStore() is DEV ONLY. Production needs a persistent store with the session key encrypted at rest.",
      "Create five route files re-exporting prepare.POST, activate.POST, status.GET, act.POST and revoke.POST under app/api/session/.",
      "The paymaster reserves about 20.5 PEPU for a session's first operation and about 6.9 PEPU for later ones (SESSION_GAS_RESERVATION_PEPU): size spend caps above that.",
    ],
    code: `import { createSponsoredSessionRoutes, createMemoryStore } from "@pepu-chain/sdk/combo";
import { tapScoreAbi, TAP_SCORE } from "./contract";

export const routes = createSponsoredSessionRoutes({
  scope: { calls: [{ target: TAP_SCORE, abi: tapScoreAbi, functionName: "tap" }] },
  store: createMemoryStore(), // DEV ONLY
  act: {
    parse: () => ({}),
    buildCalls: () => [{ to: TAP_SCORE, abi: tapScoreAbi, functionName: "tap" }],
  },
});

// app/api/session/prepare/route.ts:   export const { POST } = routes.prepare;
// app/api/session/activate/route.ts:  export const { POST } = routes.activate;
// app/api/session/status/route.ts:    export const { GET } = routes.status;
// app/api/session/act/route.ts:       export const { POST } = routes.act;
// app/api/session/revoke/route.ts:    export const { POST } = routes.revoke;
`,
  },
  {
    id: "sponsored-session-client",
    title: "Sponsored session: the component (one signature, then no popup and no gas)",
    pillars: ["combo", "session", "sponsorship"],
    file: "components/sponsored-session.tsx",
    peers: ["@privy-io/react-auth", "@zerodev/sdk", "@zerodev/permissions", "@zerodev/ecdsa-validator", "react"],
    env: ["NEXT_PUBLIC_PRIVY_APP_ID"],
    notes: ["The scope passed here must equal the server's: the browser rebuilds the policies from it and the server checks the approval against the same key, scope and expiry."],
    code: `"use client";
import { useSponsoredSession } from "@pepu-chain/sdk/combo/react";
import { tapScoreAbi, TAP_SCORE } from "@/lib/contract";

const scope = { calls: [{ target: TAP_SCORE, abi: tapScoreAbi, functionName: "tap" }] };

export function SponsoredSession() {
  const { phase, grant, act, revoke, smartAccount, expiresAt, error } = useSponsoredSession<undefined, { transactionHash: string }>({ scope });
  if (phase === "ready" || phase === "expired") return <button onClick={grant}>Start session</button>;
  if (phase !== "active") return <p>{phase}</p>;
  return (
    <>
      <p>Smart account {smartAccount}</p>
      <button onClick={() => act()}>Tap, no popup, no gas</button>
      <button onClick={revoke}>End session</button>
      {error && <p>{error.message} {error.hint}</p>}
    </>
  );
}
`,
  },
  {
    id: "multicall-read",
    title: "Batch reads through PEPU's Multicall3",
    pillars: ["chain"],
    file: "lib/balances.ts",
    peers: [],
    env: [],
    notes: ["PEPU's Multicall3 is NOT at the canonical 0xcA11... address (that has no code here). pepuMulticall uses the right one."],
    code: `import { erc20Abi } from "viem";
import { getPublicClient, pepuMainnet, pepuMulticall } from "@pepu-chain/sdk";

const client = getPublicClient(pepuMainnet);
const [name, supply] = await pepuMulticall(client, [
  { address: token, abi: erc20Abi, functionName: "name" },
  { address: token, abi: erc20Abi, functionName: "totalSupply" },
], { allowFailure: false });
`,
  },
  {
    id: "permit2-permit",
    title: "Permit2: typed data for a PermitSingle signature",
    pillars: ["chain"],
    file: "lib/permit.ts",
    peers: [],
    env: [],
    notes: ["Canonical Permit2 IS deployed on PEPU at 0x000000000022D473030F116dDEE9F6B43aC78BA3. PepuSwap has its own separate, non-canonical Permit2: do not mix them."],
    code: `import { buildPermitSingleTypedData } from "@pepu-chain/sdk";

const typedData = buildPermitSingleTypedData({
  token, amount: 1_000_000n, expiration: Math.floor(Date.now() / 1000) + 3600,
  nonce: 0, spender, sigDeadline: BigInt(Math.floor(Date.now() / 1000) + 900),
});
// const signature = await walletClient.signTypedData(typedData);
`,
  },
  {
    id: "v2-deposit",
    title: "v2 paymaster: encode a project deposit",
    pillars: ["paymaster-v2", "sponsorship"],
    file: "scripts/deposit.ts",
    peers: [],
    env: [],
    notes: [
      "The v2 paymaster is deployed on PEPU mainnet at 0xdb28528C9399C33c9A0297E8A62F39145acbC30D: the registry has its address, and the v1 paymaster is retired. Deposit only what your project needs.",
      "Deposits are ONE-WAY: nobody can withdraw them. The app id is case-sensitive: a typo funds a project nobody can claim.",
    ],
    code: `import { computeProjectId, encodeDeposit } from "@pepu-chain/sdk/paymaster";
import { parseEther } from "viem";

const projectId = computeProjectId("your-privy-app-id"); // keccak256(bytes(appId))
const tx = encodeDeposit(projectId, parseEther("10"), { paymaster: VERIFIED_V2_PAYMASTER });
// tx = { to, data, value, function }: send it from the funder's wallet.
`,
  },
];

export function findSnippet(id: string): Snippet | undefined {
  return SNIPPETS.find((s) => s.id === id.trim().toLowerCase());
}

/** The SDK subpath each import in a snippet comes from, with the names imported. Used by tests and the tool. */
export function parseSnippetImports(code: string): { subpath: string; names: string[] }[] {
  const out: { subpath: string; names: string[] }[] = [];
  for (const m of code.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+["'](@pepu-chain\/sdk[^"']*)["']/g)) {
    const names = (m[2] ?? "")
      .split(",")
      .map((n) => n.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0] ?? "")
      .filter(Boolean);
    out.push({ subpath: m[3] ?? "", names });
  }
  return out;
}
