/**
 * Local ambient declaration of the subset of `@vellumai/plugin-api` that
 * this plugin consumes.
 *
 * The host (`vellum-assistant`) is the canonical source of these types and
 * the runtime: at load time it materializes a `@vellumai/plugin-api` shim
 * into the workspace's `node_modules/` that re-binds the assistant's own
 * plugin-api namespace. That shim is runtime-only (it ships no `.d.ts`) and
 * the package is not published to npm, so this declaration exists purely so
 * the standalone repo can type-check and run its tests in isolation.
 *
 * Keep it a faithful subset of the upstream contract
 * (`assistant/src/plugin-api/types.ts` and `assistant/src/providers/types.ts`).
 * It is intentionally narrow — only the shapes the hooks here read or write.
 */
declare module "@vellumai/plugin-api" {
  export interface PluginLogger {
    info(obj: Record<string, unknown>, msg?: string): void;
    warn(obj: Record<string, unknown>, msg?: string): void;
    error(obj: Record<string, unknown>, msg?: string): void;
    debug(obj: Record<string, unknown>, msg?: string): void;
  }

  export interface TextContent {
    type: "text";
    text: string;
  }

  export interface ToolUseContent {
    type: "tool_use";
    id: string;
    name: string;
    input: Record<string, unknown>;
  }

  export interface ToolResultContent {
    type: "tool_result";
    tool_use_id: string;
    content: string;
    is_error?: boolean;
    contentBlocks?: ContentBlock[];
  }

  /**
   * The upstream union has more members (thinking, image, file, …); this
   * plugin only ever inspects text / tool_use / tool_result blocks, so the
   * remainder is represented by an open fallback.
   */
  export type ContentBlock =
    | TextContent
    | ToolUseContent
    | ToolResultContent
    | { type: string; [key: string]: unknown };

  export interface Message {
    role: "user" | "assistant";
    content: ContentBlock[];
  }

  export interface PostToolUseContext {
    readonly conversationId: string;
    toolResponse: ToolResultContent;
    readonly messages: ReadonlyArray<Message>;
    additionalContext?: string;
    readonly maxInputTokens: number;
    readonly logger: PluginLogger;
  }

  export type StopDecision = "continue" | "stop";

  export interface StopContext {
    readonly conversationId: string;
    messages: Message[];
    readonly responseContent: ReadonlyArray<ContentBlock>;
    readonly stopReason: string | null | undefined;
    decision: StopDecision;
    readonly logger: PluginLogger;
  }
}
