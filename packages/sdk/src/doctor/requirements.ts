import type { TemplateRequirement } from "./types.js";

const PRIVY_ID = "NEXT_PUBLIC_PRIVY_APP_ID";
const PRIVY_SECRET = "PRIVY_APP_SECRET";
const RPC = "PEPU_RPC_URL";

/**
 * Per-template env and Privy dashboard requirements, read from each
 * template's `.env.example` and `lib/env*.ts`. Keep in step with them.
 * `privyDashboard` holds requirement keys resolved by WP-B1's table.
 *
 * @example
 * ```ts
 * TEMPLATE_REQUIREMENTS["game-app"].requiredEnv; // includes PRIVY_AUTHORIZATION_KEY
 * ```
 */
export const TEMPLATE_REQUIREMENTS: Record<string, TemplateRequirement> = {
  "consumer-app": {
    requiredEnv: [PRIVY_ID, PRIVY_SECRET],
    optionalEnv: [],
    pillars: ["login", "wallet"],
    privyDashboard: ["login-methods", "allowed-origins", "embedded-wallets"],
  },
  "game-app": {
    requiredEnv: [
      PRIVY_ID,
      PRIVY_SECRET,
      "NEXT_PUBLIC_PRIVY_KEY_QUORUM_ID",
      "PRIVY_AUTHORIZATION_KEY",
      "NEXT_PUBLIC_GAME_CONTRACT_ADDRESS",
    ],
    optionalEnv: ["SESSION_DURATION_MINUTES", RPC],
    pillars: ["login", "wallet", "session"],
    privyDashboard: ["login-methods", "allowed-origins", "embedded-wallets", "authorization-key-quorum"],
  },
  "token-gated-app": {
    requiredEnv: [PRIVY_ID, PRIVY_SECRET],
    optionalEnv: ["NEXT_PUBLIC_GATE_ERC20_ADDRESS", "NEXT_PUBLIC_GATE_ERC721_ADDRESS"],
    requiredAnyOf: [["NEXT_PUBLIC_GATE_ERC20_ADDRESS", "NEXT_PUBLIC_GATE_ERC721_ADDRESS"]],
    pillars: ["login", "wallet", "gate"],
    privyDashboard: ["login-methods", "allowed-origins", "embedded-wallets"],
  },
  "nft-mint": {
    requiredEnv: [PRIVY_ID, PRIVY_SECRET, "NEXT_PUBLIC_NFT_CONTRACT_ADDRESS"],
    optionalEnv: [],
    pillars: ["login", "wallet", "mint"],
    privyDashboard: ["login-methods", "allowed-origins", "embedded-wallets"],
  },
  "sponsored-demo": {
    requiredEnv: [PRIVY_ID, PRIVY_SECRET],
    optionalEnv: ["NEXT_PUBLIC_PAYMASTER_CONTRACT_ADDRESS"],
    pillars: ["login", "wallet", "sponsorship"],
    // Smart Wallets: chain 97741, provider Kernel, bundler and paymaster URLs.
    privyDashboard: ["login-methods", "allowed-origins", "embedded-wallets", "smart-wallets"],
  },
  "sponsored-session-app": {
    requiredEnv: [PRIVY_ID, PRIVY_SECRET, "PEPU_BUNDLER_URL", "PEPU_PAYMASTER_URL"],
    optionalEnv: ["SESSION_DURATION_MINUTES", RPC],
    pillars: ["login", "wallet", "session", "sponsorship"],
    // Google login on; Smart Wallets deliberately NOT needed (own Kernel account).
    privyDashboard: ["login-methods", "login-methods.google", "allowed-origins", "embedded-wallets"],
  },
};
