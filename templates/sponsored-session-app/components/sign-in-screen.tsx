"use client";

import { usePrivy } from "@privy-io/react-auth";
import { PepuMark } from "@/components/pepu-mark";

export function SignInScreen() {
  const { login } = usePrivy();

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12 sm:px-6">
      <div className="card card-featured reveal w-full max-w-md text-center sm:p-8!">
        <div className="mb-5 flex items-center justify-center gap-2.5">
          <PepuMark />
          <span className="font-display text-base font-bold text-ink">PEPU</span>
        </div>
        <p className="eyebrow eyebrow-brand">Pepe Unchained V2 · sponsored session</p>
        <h1 className="mt-2 font-display text-3xl leading-tight font-bold text-ink">
          Grant once. Then act, with no popups and no gas.
        </h1>
        <p className="mt-3 text-sm leading-6 text-ink-soft">
          Sign in with Google, approve one scoped, time-limited session, and every action after that runs
          without a wallet prompt, paid for by the sponsor. The limits are enforced on-chain.
        </p>
        <button
          type="button"
          onClick={() => login({ loginMethods: ["google", "email"] })}
          className="btn btn-primary mt-6 min-h-12! w-full text-base!"
        >
          Sign in with Google
        </button>
        <p className="mt-3 text-xs text-ink-muted">
          Google or email. Your wallet is created for you. Nothing to install.
        </p>
      </div>
    </main>
  );
}
