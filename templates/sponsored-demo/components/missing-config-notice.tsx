import { PepuMark } from "@/components/pepu-mark";

/**
 * Rendered instead of the app whenever NEXT_PUBLIC_PRIVY_APP_ID is unset.
 * Shown when the Privy App ID has not been set yet.
 */
export function MissingConfigNotice() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12 sm:px-6">
      <div className="card card-featured reveal w-full max-w-lg sm:p-8!">
        <div className="mb-5 flex items-center gap-2.5">
          <PepuMark />
          <span className="font-display text-base font-bold text-ink">PEPU</span>
        </div>
        <p className="eyebrow text-warn!">
          Setup needed
        </p>
        <h1 className="mt-2 font-display text-2xl font-bold text-ink">
          Missing NEXT_PUBLIC_PRIVY_APP_ID
        </h1>
        <p className="mt-3 text-sm leading-6 text-ink-soft">
          This demo needs a Privy App ID before it can render the login
          screen. Copy <code className="code">.env.example</code>{" "}
          to <code className="code">.env.local</code> and fill it
          in with the App ID and App Secret from your Privy Dashboard,
          then restart the dev server.
        </p>
      </div>
    </main>
  );
}
