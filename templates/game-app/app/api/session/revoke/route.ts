import { createSessionRoutes } from "@pepu-chain/sdk/session/server";
import { sessionScope } from "@/lib/scope";

/** Cleanup after the client's `removeSigners` (the real revoke): deletes the now-unused policy. */
export const { POST } = createSessionRoutes({
  scope: sessionScope,
  contractAddressEnv: "NEXT_PUBLIC_GAME_CONTRACT_ADDRESS",
}).revoke;
