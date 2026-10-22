import { createSessionRoutes } from "@pepu-chain/sdk/session/server";
import { sessionScope } from "@/lib/scope";

/**
 * Creates the scoped, time-bound policy (`buildSessionPolicy`) and returns its id for `addSigners`.
 * Until `NEXT_PUBLIC_GAME_CONTRACT_ADDRESS` is set the SDK answers with a `CONFIG_MISSING_ENV` JSON error.
 */
export const { POST } = createSessionRoutes({
  scope: sessionScope,
  contractAddressEnv: "NEXT_PUBLIC_GAME_CONTRACT_ADDRESS",
}).grant;
