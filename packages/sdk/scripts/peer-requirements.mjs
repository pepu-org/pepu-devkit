// Single source of truth: subpath -> built entry (under dist/, without extension) -> peers that must be installed.
// `viem` is a peer of every entry and is installed by every app, so it is not repeated here.
// Kept in sync with the "Install" table in README.md / docs/sdk/reference.md by test/peer-guard.test.ts.
export const PEER_REQUIREMENTS = {
  "./react": { file: "react", peers: ["react", "react-dom"] },
  "./privy/react": { file: "privy/react", peers: ["react", "react-dom", "@privy-io/react-auth"] },
  "./privy/wagmi": {
    file: "privy/wagmi",
    peers: ["react", "react-dom", "@privy-io/react-auth", "@privy-io/wagmi", "wagmi", "@tanstack/react-query"],
  },
  "./privy/server": { file: "privy/server", peers: ["@privy-io/node"] },
  "./session/server": { file: "session/server", peers: ["@privy-io/node"] },
  "./session/react": { file: "session/react", peers: ["react", "react-dom", "@privy-io/react-auth"] },
  "./session/kernel": {
    file: "session/kernel",
    peers: ["@zerodev/sdk", "@zerodev/permissions", "@zerodev/ecdsa-validator"],
  },
  "./aa/kernel": { file: "aa/kernel", peers: ["@zerodev/sdk", "@zerodev/ecdsa-validator"] },
  "./aa/react": { file: "aa/react", peers: ["react", "react-dom", "@privy-io/react-auth", "permissionless"] },
  "./aa/react-direct": {
    file: "aa/react-direct",
    peers: ["react", "react-dom", "@privy-io/react-auth", "@zerodev/sdk", "@zerodev/ecdsa-validator"],
  },
  "./combo": {
    file: "combo",
    peers: ["@privy-io/node", "@zerodev/sdk", "@zerodev/permissions", "@zerodev/ecdsa-validator"],
  },
  "./combo/react": {
    file: "combo/react",
    peers: ["react", "react-dom", "@privy-io/react-auth", "@zerodev/sdk", "@zerodev/permissions", "@zerodev/ecdsa-validator"],
  },
};
