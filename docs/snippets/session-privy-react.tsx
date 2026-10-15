// Pillar 2 (Privy mode), client: grant once, then act with no popup.
// See docs/sdk/session.md and docs/recipes/grant-a-session.md
import { useSessionAct, useSessionGrant, useSessionRevoke, useSessionStatus } from "@pepu-chain/sdk/session/react";

export function Session() {
  const { state, secondsLeft, loading } = useSessionStatus({ pollMs: 30_000 });
  const { grant, status: grantStatus, error: grantError } = useSessionGrant();
  const { revoke } = useSessionRevoke();
  const { act, status: actStatus, error: actError } = useSessionAct<Record<string, never>, { hash: string }>({
    endpoint: "/api/game/tap",
  });

  // Avoid flashing the consent screen on reload.
  if (loading) return <p>Checking session</p>;

  if (state !== "active") {
    return (
      <button onClick={() => void grant()} disabled={grantStatus === "creating-policy" || grantStatus === "awaiting-consent"}>
        {state === "expired" ? "Session expired, start a new one" : "Start session"}
        {grantError ? ` (${grantError.code})` : ""}
      </button>
    );
  }

  return (
    <div>
      <p>{secondsLeft}s left</p>
      <button onClick={() => void act({}).then((r) => console.log(r.hash))} disabled={actStatus === "pending"}>
        Tap
      </button>
      <button onClick={() => void revoke()}>End session</button>
      {actError ? <p>{actError.code === "SESSION_NONE" ? "No active session" : actError.message}</p> : null}
    </div>
  );
}
