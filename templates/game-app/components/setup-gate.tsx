"use client";

import { useEffect, useState } from "react";
import { PRIVY_ENV } from "@pepu-chain/sdk/privy";
import { hasKeyQuorumId } from "@/lib/env";
import { hasGameContractAddress } from "@/lib/scope";
import { MissingConfigNotice } from "@/components/missing-config-notice";

interface ServerConfigStatus {
  hasPrivyAppSecret: boolean;
  hasPrivyAuthorizationKey: boolean;
}

/**
 * The second half of this app's "fail loud-but-friendly" story.
 * `app/providers.tsx` already guarantees `NEXT_PUBLIC_PRIVY_APP_ID` is set
 * before anything renders here. This component checks everything else —
 * the game contract address and key quorum id (client-visible, checked
 * instantly) plus the server-only Privy secrets (checked via one call to
 * `/api/config`, which reports booleans only) — before rendering the real
 * app. Missing anything shows the same readable notice instead of a
 * confusing runtime error the first time a tap or a grant is attempted.
 */
export function SetupGate({ children }: { children: React.ReactNode }) {
  const [serverStatus, setServerStatus] = useState<
    ServerConfigStatus | "loading" | "error"
  >("loading");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/config")
      .then((res) => {
        if (!res.ok) throw new Error("config check failed");
        return res.json() as Promise<ServerConfigStatus>;
      })
      .then((status) => {
        if (!cancelled) setServerStatus(status);
      })
      .catch(() => {
        if (!cancelled) setServerStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const missingClient = [
    !hasGameContractAddress && "NEXT_PUBLIC_GAME_CONTRACT_ADDRESS",
    !hasKeyQuorumId && PRIVY_ENV.keyQuorumId,
  ].filter((value): value is string => Boolean(value));

  if (missingClient.length > 0) {
    return <MissingConfigNotice missing={missingClient} />;
  }

  if (serverStatus === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="spinner" role="status" aria-label="Loading" />
      </div>
    );
  }

  if (serverStatus === "error") {
    return (
      <MissingConfigNotice
        missing={["Could not reach /api/config — is the dev server running?"]}
      />
    );
  }

  const missingServer = [
    !serverStatus.hasPrivyAppSecret && String(PRIVY_ENV.appSecret),
    !serverStatus.hasPrivyAuthorizationKey && String(PRIVY_ENV.authorizationKey),
  ].filter((value): value is string => Boolean(value));

  if (missingServer.length > 0) {
    return <MissingConfigNotice missing={missingServer} />;
  }

  return <>{children}</>;
}
