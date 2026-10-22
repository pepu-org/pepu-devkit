import { PepuMark } from "@/components/pepu-mark";

/**
 * Rendered instead of the app whenever required configuration is
 * missing — either the client-visible `NEXT_PUBLIC_PRIVY_APP_ID` (checked
 * synchronously in `app/providers.tsx`, before PrivyProvider would
 * otherwise throw) or any of the fuller set of required variables,
 * client and server, checked by `<SetupGate>` once Privy itself is up.
 * The goal is a readable, actionable message — never a stack trace.
 */
export function MissingConfigNotice({ missing }: { missing: string[] }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12 sm:px-6">
      <div className="card card-featured reveal w-full max-w-lg sm:p-8">
        <div className="mb-5 flex items-center gap-2.5">
          <PepuMark />
          <span className="font-display text-base font-bold text-ink">PEPU</span>
        </div>
        <p className="eyebrow text-warn!">
          Setup needed
        </p>
        <h1 className="mt-2 font-display text-2xl font-bold text-ink">
          Missing configuration
        </h1>
        <p className="mt-3 text-sm leading-6 text-ink-soft">
          This app needs the following before it can run. See{" "}
          <code className="code">.env.example</code>{" "}
          for what each one is and how to get it:
        </p>
        <ul className="mt-3 space-y-1">
          {missing.map((name) => (
            <li key={name}>
              <code className="code">
                {name}
              </code>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm leading-6 text-ink-soft">
          Set these in a{" "}
          <code className="code">.env.local</code>{" "}
          file at the project root (copy{" "}
          <code className="code">.env.example</code>{" "}
          if you haven&apos;t already), then restart the dev server (
          <code className="code">npm run dev</code>
          ).
        </p>
        <p className="mt-4 text-sm leading-6 text-ink-soft">
          Full walkthrough, including generating a session-signer
          authorization key and deploying the game contract, is in{" "}
          <code className="code">README.md</code>.
        </p>
      </div>
    </main>
  );
}
