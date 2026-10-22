import { createSessionActionRoute } from "@pepu-chain/sdk/session/server";
import { sessionScope, tapFunction } from "@/lib/scope";

/**
 * One gameplay `tap()`, signed by Privy with the player's session signer
 * (`eth_signTransaction`, because Privy's server-side `eth_sendTransaction`
 * rejects chain 97741) and broadcast to PEPU's RPC by the SDK. The route
 * returns 409 `SESSION_NONE` only when no signer is attached; any other
 * failure is a failed transaction, not a lost session. Until
 * `NEXT_PUBLIC_GAME_CONTRACT_ADDRESS` is set the SDK answers with a
 * `CONFIG_MISSING_ENV` JSON error.
 */
export const { POST } = createSessionActionRoute({
  scope: sessionScope,
  contractAddressEnv: "NEXT_PUBLIC_GAME_CONTRACT_ADDRESS",
  parse: () => ({}),
  buildCall: () => ({ to: sessionScope.contractAddress, abi: [tapFunction], functionName: "tap" }),
});
