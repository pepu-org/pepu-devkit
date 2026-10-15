import Image from "next/image";

/**
 * The official Pepe Unchained icon (supplied by the client as pepu.svg).
 *
 * The artwork is served from `public/pepu-logo.svg`, a size-optimised copy of
 * the client file (same artwork, transparent background, editor padding
 * trimmed). `unoptimized` because next/image does not process SVG.
 *
 * Accessibility: the mark almost always sits beside the visible app name, so
 * it is decorative by default (`alt=""`). Pass `decorative={false}` when it
 * stands alone as the brand link/identity and needs the name "Pepe Unchained".
 *
 * Do not recolour, outline, crop into a tile or put it on a light fill.
 */
export function PepuMark({
  size = 36,
  decorative = true,
}: {
  size?: number;
  decorative?: boolean;
}) {
  return (
    <Image
      src="/pepu-logo.svg"
      alt={decorative ? "" : "Pepe Unchained"}
      aria-hidden={decorative ? true : undefined}
      width={size}
      height={size}
      unoptimized
      priority
      className="shrink-0 select-none drop-shadow-[0_3px_8px_rgba(14,155,9,0.35)]"
    />
  );
}
