import { PepuMark } from "@/components/pepu-mark";

/**
 * Rendered instead of the app whenever required configuration is missing:
 * the client-visible `NEXT_PUBLIC_PRIVY_APP_ID` (checked in
 * `app/providers.tsx`, before PrivyProvider would throw) or the server-side
 * values reported by `/api/config` (checked by `<SetupGate>`). It lists names
 * only, never values. The goal is a readable, actionable message, never a
 * stack trace.
 */
export function MissingConfigNotice({ missing }: { missing: string[] }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12 sm:px-6">
      <div className="card card-featured reveal w-full max-w-lg sm:p-8">
        <div className="mb-5 flex items-center gap-2.5">
          <PepuMark />
          <span className="font-display text-base font-bold text-ink">PEPU</span>
        </div>
        <p className="eyebrow text-warn!">Setup needed</p>
        <h1 className="mt-2 font-display text-2xl font-bold text-ink">Missing configuration</h1>
        <p className="mt-3 text-sm leading-6 text-ink-soft">
          This app needs the following before it can run. See <code className="code">.env.example</code> for what
          each one is and how to get it:
        </p>
        <ul className="mt-3 space-y-1">
          {missing.map((name) => (
            <li key={name}>
              <code className="code">{name}</code>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm leading-6 text-ink-soft">
          Set these in a <code className="code">.env.local</code> file at the project root (copy{" "}
          <code className="code">.env.example</code> if you haven&apos;t already), then restart the dev server (
          <code className="code">npm run dev</code>).
        </p>
        <p className="mt-4 text-sm leading-6 text-ink-soft">
          Sponsorship needs a bundler (PEPU hosts one at <code className="code">https://bundler.pepeunchained.com</code>)
          and a paymaster URL with your project&apos;s token (see <code className="code">README.md</code>,
          &quot;What this app needs from outside&quot;).
        </p>
      </div>
    </main>
  );
}
