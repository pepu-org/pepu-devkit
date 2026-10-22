// Readiness checks for a project. See docs/sdk/doctor.md
import { runDoctor } from "@pepu-chain/sdk/doctor";
import { privyDashboardChecker } from "@pepu-chain/sdk/privy";

export async function check(): Promise<boolean> {
  const report = await runDoctor({
    env: process.env,
    template: "sponsored-session-app",
    // Adds the Privy dashboard checks (login methods, allowed origins, wallet creation setting).
    checkPrivyDashboard: privyDashboardChecker,
  });
  // Env values never appear in the report: presence and length only.
  for (const c of report.checks) {
    if (c.status === "fail" || c.status === "warn") console.log(c.status, c.id, c.fix ?? c.message);
  }
  return report.ok;
}
