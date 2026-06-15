/**
 * Shared builders for level-up hook tests. Not a test suite itself
 * (filename has no `.test.` segment), just fixtures.
 *
 * The hooks only read a narrow slice of each context, so these builders
 * produce structurally-correct shapes and cast through `unknown` to the
 * public context types where the full upstream shape is wider than what the
 * hooks touch.
 */

import type {
  ContentBlock,
  Message,
  PluginLogger,
  PostModelCallContext,
  PostToolUseContext,
  StopContext,
  ToolResultContent,
} from "@vellumai/plugin-api";

export const noopLogger: PluginLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

export function toolUseBlock(
  id: string,
  name: string,
  input: Record<string, unknown>,
): ContentBlock {
  return { type: "tool_use", id, name, input };
}

export function assistantToolCall(
  id: string,
  name: string,
  input: Record<string, unknown>,
): Message {
  return { role: "assistant", content: [toolUseBlock(id, name, input)] };
}

export function userText(text: string): Message {
  return { role: "user", content: [{ type: "text", text }] };
}

export function toolResult(
  toolUseId: string,
  content: string,
  isError = false,
): ToolResultContent {
  return {
    type: "tool_result",
    tool_use_id: toolUseId,
    content,
    is_error: isError,
  };
}

export function postToolUseCtx(args: {
  conversationId: string;
  messages: Message[];
  toolResponse: ToolResultContent;
}): PostToolUseContext {
  return {
    conversationId: args.conversationId,
    toolResponse: args.toolResponse,
    messages: args.messages,
    maxInputTokens: 200_000,
    logger: noopLogger,
  } as unknown as PostToolUseContext;
}

export function stopCtx(args: {
  conversationId: string;
  messages: Message[];
}): StopContext {
  return {
    conversationId: args.conversationId,
    messages: args.messages,
    exitReason: "no_tool_calls",
    logger: noopLogger,
  } as unknown as StopContext;
}

export function postModelCallCtx(args: {
  conversationId: string;
  messages: Message[];
  content?: ContentBlock[];
  callSite?: string;
  error?: Error;
}): PostModelCallContext {
  const lastAssistant = [...args.messages]
    .reverse()
    .find((message) => message.role === "assistant");
  return {
    conversationId: args.conversationId,
    callSite: args.callSite ?? "mainAgent",
    content: args.content ?? lastAssistant?.content ?? [],
    messages: args.messages,
    stopReason: "end_turn",
    error: args.error,
    decision: "stop",
    logger: noopLogger,
  } as unknown as PostModelCallContext;
}
