import { NetworkBadge } from "@/components/network-badge";
import { PepuMark } from "@/components/pepu-mark";

export function Header({ children }: { children?: React.ReactNode }) {
  return (
    <header className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-4 sm:px-8 sm:py-5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex items-center gap-2.5">
          <PepuMark />
          <span className="font-display text-base font-bold tracking-tight text-ink">
            PEPU Game App
          </span>
        </div>
        <NetworkBadge />
      </div>
      <div className="shrink-0">{children}</div>
    </header>
  );
}
