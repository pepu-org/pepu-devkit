// Sign with Privy on the server, broadcast to PEPU yourself.
// SERVER ONLY. See docs/recipes/sign-with-privy-broadcast-yourself.md
import { getPublicClient, pepuMainnet } from "@pepu-chain/sdk";
import { createPrivyServer, privyEnvVar } from "@pepu-chain/sdk/privy/server";
import { privySessionSigner } from "@pepu-chain/sdk/session/server";
import { signAndBroadcast } from "@pepu-chain/sdk/session";
import { TAPSCORE_ADDRESS, tapScoreAbi } from "./tapscore";

const privy = createPrivyServer();

// Easiest: the SDK's signer for a session wallet.
export async function tapWithSigner(walletId: string, address: `0x${string}`): Promise<`0x${string}`> {
  const signer = privySessionSigner({ privy, walletId, address });
  return signer.signAndBroadcast({ to: TAPSCORE_ADDRESS, abi: tapScoreAbi, functionName: "tap" });
}

// Lower level: you own the sign callback.
export async function tapWithCallback(walletId: string, address: `0x${string}`): Promise<`0x${string}`> {
  const authorizationKey = privyEnvVar("authorizationKey");
  if (!authorizationKey) throw new Error("PRIVY_AUTHORIZATION_KEY is not set");

  return signAndBroadcast({
    client: getPublicClient(pepuMainnet),
    from: address,
    to: TAPSCORE_ADDRESS,
    abi: tapScoreAbi,
    functionName: "tap",
    chainId: pepuMainnet.id,
    sign: (transaction) =>
      privy
        .wallets()
        .ethereum()
        .signTransaction(walletId, {
          params: { transaction },
          authorization_context: { authorization_private_keys: [authorizationKey] },
        }),
  });
}
