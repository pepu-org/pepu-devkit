"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Copy-to-clipboard text button with a brief, announced confirmation.
 * Clipboard access can fail (permissions, insecure context); that is not
 * worth surfacing as an error, since the value is on screen regardless.
 */
export function CopyButton({
  value,
  label = "Copy",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // See doc comment above.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={`link inline-flex min-h-8 items-center gap-1.5 text-xs ${
        copied ? "text-lime!" : ""
      }`}
    >
      {copied ? (
        <span className="success-check h-4! w-4!" aria-hidden="true">
          <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
            <path
              d="M2.5 7.5l3 3 6-7"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      ) : null}
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </button>
  );
}
