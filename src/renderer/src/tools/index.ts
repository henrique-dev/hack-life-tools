import type { ComponentType } from "react";

type Module = { default: ComponentType };

// Each tool's UI is the default export of src/tools/<tool id>/index.tsx, where
// <tool id> matches the folder of its main-process code in src/main/tools/.
// Components are discovered automatically.
const modules = import.meta.glob<Module>("./*/index.tsx", { eager: true });

export const toolComponents: Record<string, ComponentType> = Object.fromEntries(
  Object.entries(modules).map(([path, module]) => [path.split("/")[1], module.default]),
);

// Extra windows (e.g. overlays) are the default export of
// src/tools/<tool id>/windows/<name>.tsx. The main process opens them with
// host.openWindow("<tool id>/<name>"), which loads the UI at #/<tool id>/<name>.
const windowModules = import.meta.glob<Module>("./*/windows/*.tsx", { eager: true });

export const toolWindows: Record<string, ComponentType> = Object.fromEntries(
  Object.entries(windowModules).map(([path, module]) => {
    const [, toolId, , file] = path.split("/");
    return [`${toolId}/${file.replace(/\.tsx$/, "")}`, module.default];
  }),
);
