import type { Tool } from "./types";

// Each tool is src/main/tools/<tool id>/index.ts with a default export of type
// Tool. Its UI lives in src/renderer/src/tools/<tool id>/. Both sides are
// discovered automatically.
const modules = import.meta.glob<{ default: Tool }>("./*/index.ts", { eager: true });

export const tools: Record<string, Tool> = Object.fromEntries(
  Object.entries(modules)
    .map(([path, module]) => [path.split("/")[1], module.default] as const)
    .sort(([, a], [, b]) => a.name.localeCompare(b.name)),
);
