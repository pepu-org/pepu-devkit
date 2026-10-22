// Removes the CJS outputs of ESM-only subpaths (see tsup.config.ts).
import { rmSync } from "node:fs";

for (const f of ["privy/wagmi.cjs", "privy/wagmi.cjs.map", "privy/wagmi.d.cts"]) {
  rmSync(new URL(`../dist/${f}`, import.meta.url), { force: true });
}
