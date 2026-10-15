"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { MissingConfigNotice } from "@/components/missing-config-notice";

interface ServerConfigStatus {
  hasPrivyAppSecret: boolean;
  hasBundlerUrl: boolean;
  hasPaymasterUrl: boolean;
  /** Session length the server will issue (`SESSION_DURATION_MINUTES`). */
  sessionMinutes: number;
}

const ServerConfigContext = createContext<ServerConfigStatus | null>(null);

/** The server's reported config (booleans and the session length). Only valid under `SetupGate`. */
export function useServerConfig(): ServerConfigStatus {
  const config = useContext(ServerConfigContext);
  if (!config) throw new Error("useServerConfig must be used inside <SetupGate>.");
  return config;
}

/**
 * The second half of this app's "fail loud-but-friendly" story.
 * `app/providers.tsx` already guarantees `NEXT_PUBLIC_PRIVY_APP_ID` is set.
 * This component checks the server-side values (the Privy secret and the
 * bundler and paymaster URLs) with one call to `/api/config`, which reports
 * booleans only, and lists whatever is missing instead of failing the first
 * time someone starts a session.
 */
export function SetupGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<ServerConfigStatus | "loading" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/config")
      .then((res) => {
        if (!res.ok) throw new Error("config check failed");
        return res.json() as Promise<ServerConfigStatus>;
      })
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="spinner" role="status" aria-label="Loading" />
      </div>
    );
  }

  if (status === "error") {
    return <MissingConfigNotice missing={["Could not reach /api/config. Is the dev server running?"]} />;
  }

  const missing = [
    !status.hasPrivyAppSecret && "PRIVY_APP_SECRET",
    !status.hasBundlerUrl && "PEPU_BUNDLER_URL",
    !status.hasPaymasterUrl && "PEPU_PAYMASTER_URL",
  ].filter((value): value is string => Boolean(value));

  if (missing.length > 0) return <MissingConfigNotice missing={missing} />;

  return <ServerConfigContext.Provider value={status}>{children}</ServerConfigContext.Provider>;
}
