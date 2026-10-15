# Permit2

Uniswap's Permit2 is deployed on PEPU mainnet at its canonical address. This page gives the address and the deployment proof, the EIP-712 domain, typed-data examples with the SDK builders, and how it differs from PepuSwap's separate Permit2. Read it before signing a Permit2 permit or pointing a library at a Permit2 address.

> Status: **proven**. `eth_getCode` returns 9,152 bytes (checked 2026-10-03 with `pnpm --filter @pepu-chain/sdk live-check`), and a `DOMAIN_SEPARATOR()` call succeeded when it was first verified on 2026-09-24. It was deployed by PEPU, not by Uniswap.

## Address and deployment proof

| | |
|---|---|
| Address | `0x000000000022D473030F116dDEE9F6B43aC78BA3` (canonical) |
| Deployer | CREATE2 deterministic deployer `0x4e59b44847b379578588920cA78FbF26c0B4956C` |
| Salt | `0x0000000000000000000000000000000000000000d3af2663da51c10215000000` (Uniswap's upstream salt) |
| Transaction | `0xbb0a23420f47dd4dbb524d96f46115011a66fc88bbdf0963cd24a50feb6f7c93` |
| Block | 10521367 (`0xa08b17`) |
| Gas used | 2,025,730 (`0x1ee902`) |
| Runtime size | 9,152 bytes, matching Permit2's known bytecode size |
| Evidence in the repo | `contracts/permit2/` (`initcode.hex`, `salt.txt`, `predicted.txt`, `permit2-receipt.json`, `prove-address.sh`, `deploy-permit2.sh`, `compute-domain-separator.sh`) |

Why it works: Permit2's canonical address is a CREATE2 address, so the exact upstream creation bytecode plus the upstream salt through the live deployer reproduces it. `prove-address.sh` recomputes the address independently with `cast create2` and by hand from `keccak256(0xff ++ deployer ++ salt ++ keccak256(initcode))`. Compare [Multicall3](multicall3.md), which could not be recovered at its canonical address. How to reproduce: [CREATE2 and Deterministic Deployment](create2-and-deterministic-deployment.md).

## Domain and typed data

The EIP-712 domain is `{ name: "Permit2", chainId: 97741, verifyingContract: <the address above> }`. There is no `version`. `permit2Domain()` builds it:

```ts
import { permit2Domain, getPermit2 } from "@pepu-chain/sdk";

const domain = permit2Domain(); // { name: "Permit2", chainId: 97741, verifyingContract }
const { address } = getPermit2();
```

The registry ABI (`permit2Abi`) covers `DOMAIN_SEPARATOR`, `allowance`, `approve`, `nonceBitmap` and `invalidateNonces`.

## Examples

AllowanceTransfer `PermitSingle`:

```ts
import { buildPermitSingleTypedData, readPermit2Allowance } from "@pepu-chain/sdk";

const { nonce } = await readPermit2Allowance(publicClient, { owner, token, spender });

const typed = buildPermitSingleTypedData({
  token,
  amount: 1_000_000n,
  expiration: Math.floor(Date.now() / 1000) + 3600,
  nonce,
  spender,
  sigDeadline: BigInt(Math.floor(Date.now() / 1000) + 600),
});
const signature = await walletClient.signTypedData({ account, ...typed });
```

SignatureTransfer `PermitTransferFrom`:

```ts
import { buildPermitTransferFromTypedData } from "@pepu-chain/sdk";

const typed = buildPermitTransferFromTypedData({
  token,
  amount: 1_000_000n,
  spender,
  nonce: 0n, // a fresh unordered nonce; check nonceBitmap
  deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
});
const signature = await walletClient.signTypedData({ account, ...typed });
```

The user still needs a normal ERC-20 `approve` of the token to Permit2 once. See [Sign a Permit2 Permit](../recipes/permit2-permit.md).

## Versus PepuSwap's Permit2

PepuSwap deployed its own Permit2 at `0xB461c05f76d7f919FF7A3Df2B0D2593F56538b4B` and its frontend overrides the address for chain 97741. The two have different EIP-712 domains (`DOMAIN_SEPARATOR()` returns different values), so a signature for one is invalid on the other. Libraries that assume canonical Permit2 will not work against PepuSwap's copy, and PepuSwap's UI will not honour approvals made to the canonical one. Use the canonical address for your own contracts and PepuSwap's only when integrating with PepuSwap itself. See [PepuSwap Addresses](pepuswap.md).

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `InvalidSigner` or signature rejected | Signed against the wrong domain (PepuSwap's Permit2, or wrong chain id) | Use `permit2Domain()`; confirm the verifying contract |
| `InvalidNonce` | Reused or stale nonce | Read `allowance` (AllowanceTransfer) or `nonceBitmap` (SignatureTransfer) |
| Transfer reverts after a valid permit | The token was never approved to Permit2 | Send the one-time ERC-20 `approve` |
| `SignatureExpired` | `sigDeadline` or `deadline` passed | Re-sign with a later deadline |

## Related

- [Address Map](address-map.md)
- [CREATE2 and Deterministic Deployment](create2-and-deterministic-deployment.md)
- [Sign a Permit2 Permit](../recipes/permit2-permit.md)
- [PepuSwap Addresses](pepuswap.md)
