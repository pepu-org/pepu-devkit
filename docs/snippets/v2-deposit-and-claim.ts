// Register, claim, configure and fund a v2 paymaster project.
// PROVEN ON MAINNET AS A CANARY: internally reviewed 3x, external audit pending, funded in small tranches. Keep deposits small.
// SERVER OR CLI ONLY: requestClaimAttestation sends your Privy app secret to the policy service.
// See docs/sdk/paymaster.md and docs/recipes/v2-deposit-and-claim.md
import { getPublicClient, pepuMainnet } from "@pepu-chain/sdk";
import {
  buildErc7677Url,
  computeProjectId,
  configureProject,
  createPaymasterApi,
  depositFor,
  encodeClaimFromVerification,
  readProject,
  sendPaymasterCalls,
} from "@pepu-chain/sdk/paymaster";
import { requestClaimAttestation } from "@pepu-chain/sdk/paymaster/server";
import { createWalletClient, getAddress, http, parseEther } from "viem";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TAPSCORE_ADDRESS } from "./tapscore";

const publicClient = getPublicClient(pepuMainnet);
const account = privateKeyToAccount(process.env["PROJECT_OWNER_PRIVATE_KEY"] as Hex);
const walletClient = createWalletClient({ account, chain: pepuMainnet, transport: http() });

// The registry's paymasterV2 entry is the deployed canary; the helpers default to it. It is passed explicitly here
// (GET /v2/contract on the service returns it too). Override with PEPU_PAYMASTER_V2_ADDRESS.
const paymaster = getAddress(process.env["PEPU_PAYMASTER_V2_ADDRESS"] ?? "0xdb28528C9399C33c9A0297E8A62F39145acbC30D");
const appId = process.env["PRIVY_APP_ID"] as string;
const projectId = computeProjectId(appId); // keccak256(bytes(appId)), case-sensitive

export async function registerClaimConfigureFund() {
  // The paymaster service defaults to https://paymaster.pepeunchained.com (override with PEPU_PAYMASTER_URL).
  const api = createPaymasterApi();

  // 1. Sign in with the wallet that should own the project (SIWE, 1 hour session).
  await api.v2.loginWithWallet((message) => account.signMessage({ message }), {
    address: account.address,
    domain: process.env["PEPU_SIWE_DOMAIN"] as string,
  });

  // 2. Prove control of the Privy app, then submit the claim on-chain. The claim sets the owner ONLY.
  const verified = await requestClaimAttestation(api, {
    appId,
    newOwner: account.address,
    privyAppSecret: process.env["PRIVY_APP_SECRET"] as string,
  });
  const claim = encodeClaimFromVerification(verified, { paymaster });
  await sendPaymasterCalls(walletClient, [claim], { publicClient });

  // 3. Nothing is sponsored until the owner sets targets and both daily limits.
  const { calls } = configureProject({
    appId,
    paymaster,
    targets: [TAPSCORE_ADDRESS],
    dailyLimitWei: parseEther("100"), // project budget per day
    senderDailyLimitWei: parseEther("25"), // per wallet; must exceed one first-operation reservation (about 21 PEPU)
  });
  await sendPaymasterCalls(walletClient, calls, { publicClient });

  // 4. Deposits are ONE-WAY. depositFor refuses an unclaimed project by default (catches a mistyped app id).
  await depositFor({ walletClient, publicClient, appId, amountWei: parseEther("25"), paymaster });

  // 5. Index the project to get credentials (client token is browser-safe, the server key is not).
  const registered = await api.v2.projects.register({ appId, allowedOrigins: ["https://app.example.com"] });

  const state = await readProject(publicClient, projectId, { paymaster, checkTargets: [TAPSCORE_ADDRESS] });
  return {
    claimed: state.claimed,
    limitsConfigured: state.limitsConfigured,
    balance: state.balance,
    // Paste into the Privy "Paymaster URL" field, or pass to a viem paymaster client.
    erc7677Url: buildErc7677Url({ baseUrl: api.baseUrl, token: registered.token }),
  };
}
