export const EXCLUDED_NAMES: Set<string>;
export const RENAMED_DOTFILES: string[][];
export function shouldSkip(entryPath: string): boolean;
export function copyTemplateTree(src: string, dest: string): Promise<void>;
