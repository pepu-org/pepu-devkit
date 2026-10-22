/**
 * The content this whole template exists to protect. Deliberately a
 * placeholder — swap this for your real gated content (a download, a
 * Discord invite link, an exclusive page, whatever your app actually
 * gates). The point demonstrated here is the check in
 * `token-gate-panel.tsx`, not this specific payload.
 */
import { SuccessCheck } from "@/components/success-check";

export function GatedContent() {
  return (
    <div className="card card-featured reveal">
      <p className="flex items-center gap-2 eyebrow eyebrow-brand">
        <SuccessCheck />
        Unlocked
      </p>
      <h2 className="mt-3 font-display text-2xl font-bold text-ink">
        You&apos;re in.
      </h2>
      <p className="mt-2 text-sm leading-6 text-ink-soft">
        This is the content gated behind the token check above — replace
        this panel with whatever your app actually wants to protect: a
        download link, an invite, a members-only page, and so on.
      </p>
    </div>
  );
}
