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
        <p className="eyebrow eyebrow-brand">
          PEPU sponsored tap demo
        </p>
        <h1 className="mt-2 font-display text-3xl leading-tight font-bold text-ink">
          Prove gas sponsorship, in a browser
        </h1>
        <p className="mt-3 text-sm leading-6 text-ink-soft">
          Sign in, get a Kernel smart wallet holding zero PEPU, then tap
          one button to submit a real sponsored transaction. Watch the
          paymaster&apos;s own deposit drop — that&apos;s the proof.
        </p>
        <button
          type="button"
          onClick={login}
          className="btn btn-primary mt-6 min-h-12! w-full text-base!"
        >
          Sign in
        </button>
      </div>
    </main>
  );
}
