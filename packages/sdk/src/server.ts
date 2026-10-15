import { assertServerOnly } from "./internal/assert-server.js";

assertServerOnly("@pepu-chain/sdk/server");

/**
 * `@pepu-chain/sdk/server` is kept as a stable import path. It re-exports the
 * pure server-side helpers, which now live in `./session/policy.ts`. New
 * server code lives in `/privy/server`, `/session/server` and
 * `/paymaster/server`.
 */
export * from "./session/policy.js";
