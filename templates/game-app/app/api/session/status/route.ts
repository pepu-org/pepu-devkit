import { createSessionRoutes } from "@pepu-chain/sdk/session/server";
import { sessionScope } from "@/lib/scope";

/** `{ delegated, active, address }` for the signed-in player. */
export const { GET } = createSessionRoutes({
  scope: sessionScope,
  contractAddressEnv: "NEXT_PUBLIC_GAME_CONTRACT_ADDRESS",
}).status;
