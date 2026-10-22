// `@pepu-chain/sdk/react` — optional React hooks built on `@pepu-chain/sdk`'s core.
//
// This subpath is the ONLY place in this package that imports `react`.
// `react` is an optional peer dependency (see `package.json`): a consumer
// who never imports from here never needs it installed, and importing this
// subpath without `react` present is expected to fail with a normal
// module-resolution error, not something this package tries to soften.

export { usePepuBalance } from "./usePepuBalance.js";
export type {
  UsePepuBalanceOptions,
  UsePepuBalanceResult,
} from "./usePepuBalance.js";

export { usePepuChain } from "./usePepuChain.js";
export type { UsePepuChainResult } from "./usePepuChain.js";

export { useSponsorshipStatus } from "./useSponsorshipStatus.js";
