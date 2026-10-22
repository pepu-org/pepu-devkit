// Check that a paymaster project is ready to sponsor: reachable services, claimed, limits set, funded.
// Read-only: sends nothing and needs no secrets. See docs/infra/paymaster/v2-register-deposit-claim.md
import { checkSponsorship, getPublicClient, pepuMainnet } from "@pepu-chain/sdk";
import { computeProjectId, readProject } from "@pepu-chain/sdk/paymaster";

export async function verifyProject(appId: string) {
  const publicClient = getPublicClient(pepuMainnet);
  const report = await checkSponsorship({ publicClient });
  if (!report.available) console.log(report.reason, report.fixes);

  const state = await readProject(publicClient, computeProjectId(appId));
  console.log(state.claimed, state.limitsConfigured, state.balance); // true, true, a positive balance
  return { available: report.available, ready: state.claimed && state.limitsConfigured && state.balance > 0n };
}
