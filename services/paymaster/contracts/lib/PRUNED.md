# Vendored libraries: what was pruned

`account-abstraction-v7`, `openzeppelin-contracts-v5.0.2` and `forge-std` are vendored here. Their Solidity
sources are intact. We removed only files this build never compiles (tests, docs, audits PDFs, certora specs,
hardhat/CI config, deployment records, sample and mock contracts) so every tracked path in the repository stays
well under the Windows 260 character path limit and `git clone` works on Windows without `core.longpaths`.
`.github/workflows/ci.yml` fails if any tracked path grows past 130 characters.

Pruning does not change the compiled bytecode: the pinned creation-code hashes in `deploy-paymaster.sh` and
`deploy-sponsored-paymaster.sh` are re-verified after every change to this tree.

Note on `remappings.txt`: forge auto-detects the remapping `openzeppelin-contracts-v5.0.2/` from the lib layout, and
removing the vendored tests and docs flipped the detected target. solc embeds the remappings in the contract metadata,
so that changed the creation-code hashes. The remapping is therefore pinned explicitly in `remappings.txt` with the
target the deployed bytecode was built with. Do not remove that line.
