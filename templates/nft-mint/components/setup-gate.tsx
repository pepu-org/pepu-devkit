"use client";

import { hasNftContractAddress } from "@/lib/env";
import { MissingConfigNotice } from "@/components/missing-config-notice";

/**
 * The second half of this app's "fail loud-but-friendly" story.
 * `app/providers.tsx` already guarantees `NEXT_PUBLIC_PRIVY_APP_ID` is set
 * before anything renders here. This checks the other required piece of
 * configuration — a deployed NFT contract address — before rendering the
 * real app. Everything this template reads is a `NEXT_PUBLIC_*` variable
 * (there are no server-only secrets here), so this check runs
 * synchronously on the client.
 */
export function SetupGate({ children }: { children: React.ReactNode }) {
  if (!hasNftContractAddress) {
    return (
      <MissingConfigNotice missing={["NEXT_PUBLIC_NFT_CONTRACT_ADDRESS"]} />
    );
  }

  return <>{children}</>;
}
