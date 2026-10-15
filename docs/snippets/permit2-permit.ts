// Sign a Permit2 AllowanceTransfer permit. See docs/recipes/permit2-permit.md
import {
  buildPermitSingleTypedData,
  getPermit2,
  getPublicClient,
  pepuMainnet,
  readPermit2Allowance,
} from "@pepu-chain/sdk";
import type { WalletClient } from "viem";

const client = getPublicClient(pepuMainnet);

export async function signPermit(
  walletClient: WalletClient,
  token: `0x${string}`,
  spender: `0x${string}`,
  amount: bigint,
): Promise<{ signature: `0x${string}`; permit2: `0x${string}` }> {
  const owner = walletClient.account?.address;
  if (!owner) throw new Error("Connect a wallet first");

  // The nonce lives in Permit2; read it rather than guessing.
  const current = await readPermit2Allowance(client, { owner, token, spender });

  const now = Math.floor(Date.now() / 1000);
  const typed = buildPermitSingleTypedData({
    token,
    amount,
    expiration: now + 60 * 60, // allowance lifetime
    nonce: current.nonce,
    spender,
    sigDeadline: BigInt(now + 30 * 60), // how long this signature may be submitted
  });

  const signature = await walletClient.signTypedData({
    account: owner,
    domain: typed.domain,
    types: typed.types,
    primaryType: typed.primaryType,
    message: typed.message,
  });
  return { signature, permit2: getPermit2().address };
}
