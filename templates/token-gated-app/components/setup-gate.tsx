"use client";

import { hasAnyGateToken } from "@/lib/env";
import { MissingConfigNotice } from "@/components/missing-config-notice";

/**
 * The second half of this app's "fail loud-but-friendly" story.
 * `app/providers.tsx` already guarantees `NEXT_PUBLIC_PRIVY_APP_ID` is set
 * before anything renders here. This checks the other required piece of
 * configuration — at least one gate token address — before rendering the
 * real app. Everything this template reads is a `NEXT_PUBLIC_*` variable
 * (there are no server-only secrets here, unlike the `game-app` template),
 * so this check can run synchronously on the client with no `/api/config`
 * round trip.
 */
export function SetupGate({ children }: { children: React.ReactNode }) {
  if (!hasAnyGateToken) {
    return (
      <MissingConfigNotice
        missing={[
          "NEXT_PUBLIC_GATE_ERC20_ADDRESS or NEXT_PUBLIC_GATE_ERC721_ADDRESS",
        ]}
      />
    );
  }

  return <>{children}</>;
}
