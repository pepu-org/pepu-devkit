// Checks .env.local against this template's requirements using the SDK's
// doctor: env presence and shape, the chain RPC, and the Privy dashboard
// settings (including that http://localhost:3000 is an allowed origin).
// Values are never printed.
//   npm run doctor            full check (network)
//   npm run doctor -- --offline
// Running on another port? Set PEPU_APP_ORIGIN, for example http://localhost:3001.
import { existsSync } from "node:fs";
import { runDoctor } from "@pepu-chain/sdk/doctor";
import { privyDashboardChecker } from "@pepu-chain/sdk/privy";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const offline = process.argv.includes("--offline");
const report = await runDoctor({
  env: process.env,
  template: "consumer-app",
  offline,
  origin: process.env.PEPU_APP_ORIGIN?.trim() || "http://localhost:3000",
  checkPrivyDashboard: privyDashboardChecker,
});
const label = { pass: "ok  ", warn: "WARN", fail: "FAIL", skip: "skip" };
for (const c of report.checks) {
  console.log(`${label[c.status] ?? c.status} ${c.id}: ${c.message}${c.fix ? ` - ${c.fix}` : ""}`);
}
if (report.ok) console.log("ok   no failing checks");
process.exit(report.ok ? 0 : 1);
