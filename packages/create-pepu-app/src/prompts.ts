import * as p from "@clack/prompts";
import { PACKAGE_MANAGERS, type PackageManagerName } from "./package-manager.js";
import { featureSummary, type TemplateInfo } from "./templates.js";

/**
 * Interactive prompts on top of `@clack/prompts` (arrow-key select, spinner,
 * cancel handling). Only reached when stdin is a TTY and neither `--yes` nor
 * `--json` was passed; each question is skipped when its flag was given.
 */

function unwrap<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel("Cancelled. Nothing was created.");
    process.exit(1);
  }
  return value as T;
}

export function intro(title: string): void {
  p.intro(title);
}

export function outro(message: string): void {
  p.outro(message);
}

export function note(message: string, title: string): void {
  p.note(message, title);
}

export function logWarn(message: string): void {
  p.log.warn(message);
}

export function logStep(message: string): void {
  p.log.success(message);
}

export function spinner(): ReturnType<typeof p.spinner> {
  return p.spinner();
}

/** Template picker: each option shows its features; the description appears on the highlighted row. */
export async function promptTemplate(
  defaultValue: string,
  templates: readonly TemplateInfo[],
): Promise<string> {
  const answer = await p.select<string>({
    message: "Which template?",
    initialValue: defaultValue,
    options: templates.map((t) => ({
      value: t.name,
      label: `${t.title}  [${featureSummary(t, " / ")}]`,
      hint: t.description,
    })),
  });
  return unwrap(answer);
}

export async function promptProjectName(defaultValue: string): Promise<string> {
  const answer = await p.text({
    message: "Project name",
    placeholder: defaultValue,
    defaultValue,
  });
  const name = unwrap(answer).trim();
  return name.length > 0 ? name : defaultValue;
}

export async function promptPackageManager(defaultValue: PackageManagerName): Promise<PackageManagerName> {
  const answer = await p.select<PackageManagerName>({
    message: "Package manager",
    initialValue: defaultValue,
    options: PACKAGE_MANAGERS.map((pm) => ({
      value: pm,
      label: pm,
      ...(pm === defaultValue ? { hint: "detected" } : {}),
    })),
  });
  return unwrap(answer);
}

export async function promptConfirm(message: string, initialValue: boolean): Promise<boolean> {
  return unwrap(await p.confirm({ message, initialValue }));
}
