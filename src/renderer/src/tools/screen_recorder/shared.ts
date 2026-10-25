import { callTool } from "../../api";

export type { Options, Settings, Source, Status } from "../../../../main/tools/screen_recorder";

export const TOOL_ID = "screen_recorder";

export const call = <T = unknown>(method: string, ...args: unknown[]) => callTool<T>(TOOL_ID, method, ...args);
