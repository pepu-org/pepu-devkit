/**
 * A handful of manual ANSI codes instead of a `chalk`/`picocolors`
 * dependency — this CLI is small enough that it isn't worth the
 * (tiny, but nonzero) install weight. Colors no-op when stdout isn't a
 * TTY (piped output, CI logs).
 */
const supportsColor = process.stdout.isTTY === true && process.env.NO_COLOR === undefined;

function wrap(code: string): (text: string) => string {
  return (text: string) => (supportsColor ? `[${code}m${text}[0m` : text);
}

export const color = {
  green: wrap("32"),
  yellow: wrap("33"),
  cyan: wrap("36"),
  red: wrap("31"),
  bold: wrap("1"),
  dim: wrap("2"),
};

export function step(message: string): void {
  console.log(`${color.green("✔")} ${message}`);
}

export function info(message: string): void {
  console.log(color.dim(message));
}

export function warn(message: string): void {
  console.log(`${color.yellow("!")} ${message}`);
}

export function fail(message: string): void {
  console.error(`${color.red("✖")} ${message}`);
}
