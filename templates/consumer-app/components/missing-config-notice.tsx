import { PepuMark } from "@/components/pepu-mark";

/**
 * Rendered instead of the app whenever NEXT_PUBLIC_PRIVY_APP_ID is unset.
 * The goal is a readable, actionable message — not a stack trace from a
 * Privy SDK call that got an empty string for an app id.
 */
export function MissingConfigNotice() {
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
          Missing NEXT_PUBLIC_PRIVY_APP_ID
        </h1>
        <p className="mt-3 text-sm leading-6 text-ink-soft">
          This app needs a Privy App ID before it can render the login
          screen. It takes about a minute to get one:
        </p>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-ink-soft">
          <li>
            Go to{" "}
            <a
              href="https://dashboard.privy.io"
              target="_blank"
              rel="noreferrer"
              className="link"
            >
              dashboard.privy.io
            </a>{" "}
            and create a free app.
          </li>
          <li>Copy the App ID from that app&apos;s Settings page.</li>
          <li>
            Create a file named <code className="code">.env.local</code> in
            the project root (copy <code className="code">.env.example</code>{" "}
            if you haven&apos;t already) and set:
          </li>
        </ol>
        <pre className="code-block mt-3">
          NEXT_PUBLIC_PRIVY_APP_ID=your-app-id-here
        </pre>
        <p className="mt-4 text-sm leading-6 text-ink-soft">
          Then restart the dev server (<code className="code">npm run dev</code>).
        </p>
      </div>
    </main>
  );
}
