/**
 * Cross-platform process launch for package managers and `git`.
 *
 * On Windows, `npm`, `pnpm` and `yarn` are `.cmd` shims, and Node (20.12+) refuses to spawn a `.cmd` without a shell.
 * Passing an args array together with `shell: true` works but is deprecated (DEP0190: the args are concatenated, not
 * escaped, and Node 24 prints a warning). The supported shape is a single command string with `shell: true` and no
 * args array, so that is what Windows gets here; every other platform spawns the binary directly with `shell: false`.
 * Arguments come from this package's own constants, never from user input, and are still quoted defensively.
 */

export interface ResolvedCommand {
  command: string;
  args: string[];
  shell: boolean;
}

const SAFE = /^[\w@%+=:,./\\-]+$/;

/** Quote one argument for a Windows command line. */
export function quoteWindowsArg(arg: string): string {
  if (arg !== "" && SAFE.test(arg)) return arg;
  // Double any backslashes that precede a quote (or the closing quote), then escape the quotes.
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
}

/**
 * Resolves `cmd args...` into spawn options that never combine `shell: true` with an args array.
 * `platform` is injectable for tests.
 */
export function resolveCommand(cmd: string, args: readonly string[], platform: NodeJS.Platform = process.platform): ResolvedCommand {
  if (platform !== "win32") return { command: cmd, args: [...args], shell: false };
  return { command: [cmd, ...args.map(quoteWindowsArg)].join(" "), args: [], shell: true };
}
