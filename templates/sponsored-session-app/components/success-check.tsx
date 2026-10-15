/**
 * Animated success tick: pops in, draws the check, and sends out one ring.
 * Pure CSS (see `.success-check` in pepu-design.css); under
 * `prefers-reduced-motion` it renders as a static tick. The tick shape (not
 * just the green) carries the meaning, so it is not colour-only.
 */
export function SuccessCheck() {
  return (
    <span className="success-check" aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path
          d="M2.5 7.5l3 3 6-7"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
