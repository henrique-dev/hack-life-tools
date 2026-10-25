import type { Host } from "../host";

/**
 * A tool's API. Its public methods (not starting with "_") can be called from
 * any window with callTool(). Arguments and results must be serializable.
 */
export interface ToolApi {
  /** Called when the app quits. */
  shutdown?(): void | Promise<void>;
}

/** Default export of src/main/tools/<tool id>/index.ts. */
export interface Tool {
  name: string;
  description: string;
  createApi(host: Host): ToolApi;
}
