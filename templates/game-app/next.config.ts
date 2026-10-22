import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    resolveAlias: {
      // One copy of Privy. `@pepu-chain/sdk/privy/react` renders <PrivyProvider>,
      // and this app calls usePrivy() from its own import. Inside a pnpm
      // workspace each of those can resolve to a different peer-dependency
      // variant of the package, i.e. two React contexts, and usePrivy() then
      // never becomes `ready` (the app sits on its loading spinner forever).
      // Pointing both at this app's copy makes them share one context.
      "@privy-io/react-auth": "./node_modules/@privy-io/react-auth",
    },
  },
};

export default nextConfig;
