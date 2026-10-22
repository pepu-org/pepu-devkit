# Vendored libraries: what was pruned

`account-abstraction-v7`, `openzeppelin-contracts-v5.0.2` and `forge-std` are vendored here. Their Solidity
sources are intact for everything the build compiles. We removed only files this build never compiles: tests, docs,
audit PDFs, certora specs, hardhat/CI config, deployment records, sample and mock contracts, and (in the second pass)
every `.sol` file that is not in the compile graph of `src/` and `test/`, for example the unused OpenZeppelin
governance, `ERC721`, `ERC1155`, proxy and access-control extension contracts. The kept set is exactly the 51
library sources listed in `cache/solidity-files-cache.json` after a clean `forge build --force`.

The result is that the longest tracked path in the repository is 112 characters
(`services/paymaster/contracts/lib/openzeppelin-contracts-v5.0.2/contracts/utils/cryptography/MessageHashUtils.sol`,
which the paymaster compiles; it was 126 before the second pass). That keeps a clone working on Windows from a base
folder of up to about 147 characters without `core.longpaths`, and with `git clone -c core.longpaths=true` for deeper
folders. `.github/workflows/ci.yml` fails if any tracked path grows past 112 characters
(`scripts/check-path-length.mjs`).

112 is the floor for this tree. The library directory names and the `contracts/...` layout are embedded in the
contract metadata (and therefore in the creation code), so renaming `openzeppelin-contracts-v5.0.2` or moving a
compiled file would change the pinned hashes.

Pruning does not change the compiled bytecode: the pinned creation-code hashes in `deploy-paymaster.sh`
(`0xe987efab0333ca59a6ee72d235fbc05a862fb4473a11d4237b29a364ad745c15`) and `deploy-sponsored-paymaster.sh`
(`0x86153ab5c7faa3a83ea9949b2a44ebba196ce367227d376b9a28290e3a468164`) are re-verified after every change to this
tree, from a `git archive` extraction, with upstream `forge` (not foundry-zksync).

Note on `remappings.txt`: forge auto-detects the remapping `openzeppelin-contracts-v5.0.2/` from the lib layout, and
removing the vendored tests and docs flipped the detected target. solc embeds the remappings in the contract metadata,
so that changed the creation-code hashes. The remapping is therefore pinned explicitly in `remappings.txt` with the
target the deployed bytecode was built with. Do not remove that line.
