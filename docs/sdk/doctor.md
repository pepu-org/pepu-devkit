# /doctor

`@pepu-chain/sdk/doctor` runs project readiness checks: environment variables, Privy app id format, chain RPC, bundler and paymaster reachability, and the Privy dashboard settings. It never returns or logs a value from your environment: presence and length only.

> Status: proven. It backs the CLI doctor, the MCP tools `pepu_check_env` and `pepu_check_privy_config`, and the `/pepu-doctor` command.

## Import, peers and boundary

| Item | Value |
|---|---|
| Import | `@pepu-chain/sdk/doctor` |
| Server or client | Node or any runtime with `fetch`. Use it in scripts and server code; it reads an env map you pass in |
| Peer dependencies | None (the key generator uses WebCrypto) |

## Exports

| Export | Signature | What it abstracts |
|---|---|---|
| `runDoctor` | `(o: RunDoctorOptions) => Promise<DoctorReport>` | Every check in one call. `RunDoctorOptions`: `env`, `template?`, `pillars?`, `fetch?`, `offline?`, `checkPrivyDashboard?` |
| `checkPepuEnv` | `(o: { env; template?; pillars? }) => EnvCheckResult` | Per-variable verdict: `ok`, `missing`, `placeholder` or `malformed`, with `secret`, `length`, `required` and a `fix`. Never the value |
| `checkChainRpc` | `(o?: { rpcUrl?; fetch? }) => Promise<DoctorCheck>` | The RPC answers and reports chain 97741 |
| `checkPrivyAppIdFormat` | `(appId: string \| undefined) => DoctorCheck` | `PRIVY_APP_ID_PATTERN`: a leading `c` then 20 to 29 lowercase alphanumerics |
| `checkSponsorshipEndpoints` | `(o?: { env?; fetch? }) => Promise<DoctorCheck[]>` | The hosted bundler and paymaster service are the defaults and are probed (the paymaster at `<base>/health`); a URL that resolves to nothing is a skip, and one that is set but unreachable is a failure. URLs never appear in messages |
| `TEMPLATE_REQUIREMENTS` | `Record<string, TemplateRequirement>` | Per-template env and Privy dashboard needs: `requiredEnv`, `optionalEnv`, `requiredAnyOf?`, `pillars`, `privyDashboard` |
| `generatePrivyAuthorizationKey` | `() => Promise<PrivyAuthorizationKeyPair>` | A P-256 key pair in the format Privy expects (`publicKey` base64 SPKI, `privateKey` base64 PKCS8). Writes and logs nothing. Register the public half in the dashboard, keep the private half in server env only |
| Types | `DoctorCheck`, `DoctorReport`, `EnvCheckResult`, `EnvItem`, `EnvItemStatus`, `CheckStatus`, `Pillar`, `PrivyDashboardChecker`, `PrivyDashboardRequirementKey`, `TemplateRequirement`, `RunDoctorOptions`, `PrivyAuthorizationKeyPair` | |

`Pillar` is `login`, `wallet`, `session`, `sponsorship`, `gate` or `mint`. `CheckStatus` is `pass`, `fail`, `warn` or `skip`. `DoctorReport` is `{ ok, checks, env }` and `ok` is true when no check failed.

Plug in the Privy dashboard check with `privyDashboardChecker` from [/privy](privy.md). Without it the report carries a `privy.dashboard` skip.

## Example

```ts
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
```

Source: `docs/snippets/doctor.ts`, type-checked against the SDK.

## Errors

`runDoctor` reports problems as `DoctorCheck`s and does not throw for a failing project. An unknown `template` becomes a failing `template` check. `generatePrivyAuthorizationKey` can reject if WebCrypto is unavailable.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `env.PEPU_BUNDLER_URL is missing` for a sponsorship template | The variable was cleared, or the template needs an explicit value | Set it to `https://bundler.pepeunchained.com` (the hosted bundler) or your own bundler (local default `http://localhost:4337`) |
| `privy.dashboard` is skipped | No checker injected, unknown template, or no app id | Pass `checkPrivyDashboard: privyDashboardChecker` |
| A check says `placeholder` | The value is still `your-...` or `<...>` from `.env.example` | Replace it with the real value |

## Related

- [Privy Env Vars and Verification](../privy/env-and-checks.md)
- [Environment Variables](../reference/env-vars.md)
- [/privy](privy.md)
