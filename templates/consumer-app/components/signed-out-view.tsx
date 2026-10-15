"use client";

import { usePrivy } from "@privy-io/react-auth";
import { Header } from "@/components/header";

export function SignedOutView() {
  const { login, ready } = usePrivy();

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-12 text-center sm:px-6 sm:py-16">
        <div className="stagger max-w-xl">
          <p className="eyebrow eyebrow-brand">
            Pepe Unchained V2 · a real onchain starter
          </p>
          <h1 className="mt-3 text-4xl leading-[1.1] font-bold text-ink sm:text-5xl">
            Sign in with your email.
            <br />
            Get a wallet. Do something onchain.
          </h1>
          <p className="mt-5 text-base leading-7 text-ink-soft">
            No seed phrase, no browser extension, no prior crypto
            knowledge required. This is what onboarding to Pepe Unchained
            can look like for someone who has never used a wallet before.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <button
              onClick={login}
              disabled={!ready}
              className="btn btn-primary min-h-12! w-full max-w-xs text-base! sm:w-auto sm:px-10!"
            >
              {!ready && <span className="spinner spinner-sm" aria-hidden="true" />}
              {ready ? "Sign in" : "Loading…"}
            </button>
            <p className="text-xs text-ink-muted">
              Email, Google, or connect an existing wallet.
            </p>
          </div>
        </div>
      </main>
      <footer className="px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-6 text-center text-xs text-ink-muted">
        Built on Pepe Unchained V2 with Privy, wagmi, and{" "}
        <code className="code">@pepu-chain/sdk</code>.
      </footer>
    </div>
  );
}
