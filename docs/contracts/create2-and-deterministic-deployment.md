# CREATE2 and Deterministic Deployment

How PEPU used its deterministic deployer to put Multicall3 and Permit2 on chain, what salt and init code each used, and how to reproduce the addresses. Read it to deploy your own contract at a predictable address or to verify these deployments.

## The deployer

| | |
|---|---|
| Address | `0x4e59b44847b379578588920cA78FbF26c0B4956C` |
| What it is | The standard "Nick's method" deterministic deployer, at the same address as on every chain that has it |
| Registry key | `create2Factory` |
| Calling convention | Send a transaction **to** the deployer whose data is `salt (32 bytes) ‖ initCode`. It runs `CREATE2` and the new contract's address is not returned (compute it) |
| Address formula | `address = last 20 bytes of keccak256(0xff ‖ deployer ‖ salt ‖ keccak256(initCode))` |

Anything deployed through it with the same salt and init code lands at the same address on any chain that has the deployer. The Alto bundler also uses it to deploy its own simulation contracts.

## What was deployed this way

| Contract | Salt | Init code | Address | Transaction |
|---|---|---|---|---|
| Multicall3 (PEPU-specific) | all zeros | `contracts/multicall3/initcode.hex`, from `mds1/multicall3` source, solc 0.8.12, optimizer 10,000,000 runs | `0x9CE19273Ae9c24437DFF512E8DFCAed4E4B001bd` (`contracts/multicall3/predicted.txt`) | `0xf9d8f45010e2a2020871af9a677d134e9b43e039a0a73c09bcd22d1825f99241`, block 10521048 |
| Permit2 (canonical) | `0x0000000000000000000000000000000000000000d3af2663da51c10215000000` (`contracts/permit2/salt.txt`) | `contracts/permit2/initcode.hex`, the exact upstream creation bytecode | `0x000000000022D473030F116dDEE9F6B43aC78BA3` (`contracts/permit2/predicted.txt`) | `0xbb0a23420f47dd4dbb524d96f46115011a66fc88bbdf0963cd24a50feb6f7c93`, block 10521367 |

Permit2 reproduces its **canonical** address because that address was itself produced by CREATE2 with Uniswap's salt. Multicall3's canonical address was not produced by CREATE2 (it came from a plain `CREATE` by a burn key through a pre-signed 1,000,000-gas transaction), so no salt can reproduce it, and that transaction cannot run on this chain. PEPU's Multicall3 is therefore at a different, but reproducible, address. See [The Multicall3 Trap](multicall3.md).

## Reproduce an address

With upstream Foundry (not `foundry-zksync`, which can shadow `forge` and `cast` on `PATH`; check `forge --version`):

```bash
cast create2 \
  --deployer 0x4e59b44847b379578588920cA78FbF26c0B4956C \
  --salt 0x0000000000000000000000000000000000000000d3af2663da51c10215000000 \
  --init-code "$(cat contracts/permit2/initcode.hex)"
# expect 0x000000000022D473030F116dDEE9F6B43aC78BA3
```

By hand: `keccak256(0xff ++ deployer ++ salt ++ keccak256(initcode))`, take the last 40 hex characters. `contracts/permit2/prove-address.sh` does both and prints `RESULT: MATCH`.

Check on chain, read-only:

```bash
cast code 0x000000000022D473030F116dDEE9F6B43aC78BA3 --rpc-url https://rpc-pepu-v2-mainnet-0.t.conduit.xyz
```

## Deploy your own contract deterministically

1. Compile and keep the creation bytecode (`initcode`).
2. Pick a salt and compute the predicted address as above.
3. Check the predicted address has no code.
4. Send a transaction to `0x4e59…956C` with data `salt ‖ initCode`. Set an explicit gas limit: Arbitrum Nitro charges differently from L1, and a bytecode that fits in 1,000,000 gas elsewhere can need far more here (Multicall3 needed about 14.3 million for the plain-`CREATE` route; the CREATE2 deploy used 874,693).
5. Re-check `eth_getCode` at the predicted address.

## Scripts

| Script | Purpose |
|---|---|
| `deploy/deploy-multicall3.sh` | Deploys Multicall3. Idempotent: exits if code already exists at the predicted address |
| `deploy/verify-multicall3.sh` | Verification checks |
| `contracts/permit2/deploy-permit2.sh` | Rebuilds, compares the creation bytecode to `initcode.hex`, refuses to broadcast on drift, deploys |
| `contracts/permit2/prove-address.sh` | Independent address computation, read-only |
| `contracts/permit2/compute-domain-separator.sh`, `estimate-gas.sh` | Domain and gas checks |
| `deploy/deploy-tapscore.sh`, `deploy/fund-paymaster.sh`, `deploy/allow-bundler.sh` | TapScore deploy and paymaster operations (not CREATE2) |

These read private keys and the RPC key from gitignored env files. Do not paste keys anywhere.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Computed address does not match | Different init code (compiler version, optimizer runs, constructor args or line endings) | Reproduce the exact build settings; `forge build --force` and compare to `initcode.hex` |
| Deployment transaction succeeds but no code at the address | Wrong salt or init code, or the call reverted inside the deployer (it returns no data) | Recompute; raise the gas limit |
| Out of gas on a plain `CREATE` replay | Nitro needs far more gas than the replayed transaction allows | Use CREATE2 through the deployer instead |
| `forge` behaves oddly | `foundry-zksync` first on `PATH` | Use upstream Foundry |

## Related

- [Address Map](address-map.md)
- [The Multicall3 Trap](multicall3.md)
- [Permit2](permit2.md)
- [Deploy and Verify a Contract](deployment.md)
