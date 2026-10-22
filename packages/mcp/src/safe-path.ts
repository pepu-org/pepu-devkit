/**
 * Path guards for every tool that touches the filesystem.
 *
 * Rules: absolute paths only, no `..` segments in the input, no NUL bytes, no
 * filesystem roots, no system directories. Callers get a normalized path back
 * or a PepuToolError with a what/why/fix message.
 */

import fs from "node:fs";
import path from "node:path";
import { actionableError } from "./errors.js";

const FORBIDDEN_PREFIXES_POSIX = ["/etc", "/bin", "/sbin", "/usr", "/boot", "/dev", "/proc", "/sys", "/var/lib"];
const FORBIDDEN_PREFIXES_WIN = ["c:\\windows", "c:\\program files", "c:\\program files (x86)", "c:\\programdata"];

function hasTraversal(input: string): boolean {
  return input.split(/[\\/]+/).some((seg) => seg === "..");
}

/** Validate and normalize an absolute path. Does not touch the filesystem. */
export function assertSafeAbsolutePath(input: string, label: string): string {
  if (typeof input !== "string" || input.trim() === "") {
    actionableError(`${label} is empty.`, "A path is required.", "Pass an absolute path.");
  }
  if (input.includes("\0")) {
    actionableError(`${label} contains a NUL byte.`, "That is never a valid path.", "Pass a plain absolute path.");
  }
  if (!path.isAbsolute(input)) {
    actionableError(
      `${label} must be an absolute path.`,
      "Relative paths resolve against the server's working directory, which is not your project.",
      "Pass the full path, for example /home/me/my-app or C:\\Users\\me\\my-app."
    );
  }
  if (hasTraversal(input)) {
    actionableError(`${label} contains a ".." segment.`, "Parent-directory segments are refused so a path cannot escape its intended folder.", "Pass the final, already-resolved absolute path.");
  }
  const resolved = path.resolve(input);
  if (path.parse(resolved).root === resolved) {
    actionableError(`${label} is a filesystem root.`, "Writing to or scanning a drive or filesystem root is refused.", "Pick a project folder.");
  }
  const lower = resolved.toLowerCase();
  const blocked = process.platform === "win32" ? FORBIDDEN_PREFIXES_WIN : FORBIDDEN_PREFIXES_POSIX;
  const normalizedLower = process.platform === "win32" ? lower : resolved;
  if (blocked.some((p) => normalizedLower === p || normalizedLower.startsWith(p + (process.platform === "win32" ? "\\" : "/")))) {
    actionableError(`${label} points inside a system directory.`, "System directories are refused.", "Pick a folder in your own workspace.");
  }
  return resolved;
}

/** An existing directory (symlinks resolved). */
export function assertExistingDirectory(input: string, label: string): string {
  const resolved = assertSafeAbsolutePath(input, label);
  let real: string;
  try {
    real = fs.realpathSync(resolved);
  } catch {
    return actionableError(`${label} does not exist.`, `Nothing found at ${resolved}.`, "Check the path, or scaffold the project first.");
  }
  if (!fs.statSync(real).isDirectory()) {
    actionableError(`${label} is not a directory.`, `${real} is a file.`, "Pass the project folder, not a file inside it.");
  }
  return real;
}

/**
 * A directory that does not exist, or exists and is empty. Its parent must
 * exist. Returns the resolved path.
 */
export function assertNewOrEmptyDirectory(input: string, label: string): string {
  const resolved = assertSafeAbsolutePath(input, label);
  const parent = path.dirname(resolved);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    actionableError(`The parent folder of ${label} does not exist.`, `${parent} was not found.`, "Create the parent folder first, or pick an existing location.");
  }
  if (fs.existsSync(resolved)) {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      actionableError(`${label} already exists and is a file.`, "A project cannot be created over a file.", "Choose a different path.");
    }
    if (fs.readdirSync(resolved).length > 0) {
      actionableError(`${label} already exists and is not empty.`, "Scaffolding into a non-empty folder could overwrite your files, so it is refused.", "Choose a new folder name, or empty this one first.");
    }
  }
  return resolved;
}

/** `.env`, `.env.local`, `.env.production.local` and similar, never anything else. */
export function assertEnvFileName(file: string, label: string): void {
  const base = path.basename(file);
  if (!/^\.env(\.[A-Za-z0-9_-]+)*$/.test(base)) {
    actionableError(
      `${label} must be an env file such as .env.local.`,
      `"${base}" does not look like one.`,
      "Pass the absolute path to .env.local (or .env) inside your project."
    );
  }
}
