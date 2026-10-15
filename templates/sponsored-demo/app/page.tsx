"use client";

import { usePrivy } from "@privy-io/react-auth";
import { SignInScreen } from "@/components/sign-in-screen";
import { SignedInView } from "@/components/signed-in-view";

export default function Home() {
  const { ready, authenticated } = usePrivy();

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="spinner" role="status" aria-label="Loading" />
      </div>
    );
  }

  return authenticated ? <SignedInView /> : <SignInScreen />;
}
