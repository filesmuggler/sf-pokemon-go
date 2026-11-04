import type { ChatCompletionRequest, Tool, ToolCall } from "@mistralai/mistralai/models/components";
import { getMistralClient } from "./client";
import { executeTool, isToolName, summarizeToolResult } from "./tools";
import type { AgentStep } from "@/lib/quest/schema";

export type Message = ChatCompletionRequest["messages"][number];

function parseToolArgs(call: ToolCall): unknown {
  const args = call.function.arguments;
  if (typeof args !== "string") return args;
  try {
    return JSON.parse(args);
  } catch {
    return {};
  }
}

export function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((chunk) => (chunk && typeof chunk === "object" && "text" in chunk ? String(chunk.text) : ""))
      .join("");
  }
  return "";
}

/** How a loop executes the tools the model asks for. Defaults to the 311/OSM toolset. */
export interface ToolExecutor {
  isTool(name: string): boolean;
  execute(name: string, args: unknown): Promise<unknown>;
  summarize(name: string, result: unknown): string;
}

export const defaultExecutor: ToolExecutor = {
  isTool: isToolName,
  execute: (name, args) => {
    if (!isToolName(name)) throw new Error(`Unknown tool: ${name}`);
    return executeTool(name, args);
  },
  summarize: (name, result) => (isToolName(name) ? summarizeToolResult(name, result) : "ok"),
};

/**
 * Generic investigation loop: let the model call tools until it stops or
 * `maxRounds` is hit. Mutates `messages` (appends assistant + tool turns) and
 * `trace` (one entry per tool call) so callers can hand the transcript to a
 * second, structured-output call. Returns the final assistant text.
 */
export async function runToolLoop(opts: {
  model: string;
  messages: Message[];
  tools: Tool[];
  trace: AgentStep[];
  maxRounds?: number;
  temperature?: number;
  executor?: ToolExecutor;
  /** Attach full tool results to trace steps (for debugging UIs). */
  includeResults?: boolean;
  /** Force a tool call on the first round (default true). */
  forceFirstTool?: boolean;
  /**
   * If the model stops right after a round in which a tool call failed, push
   * it back (up to N times) to fix and retry instead of answering from memory.
   */
  nudgeAfterError?: number;
}): Promise<string> {
  const mistral = getMistralClient();
  const { model, messages, tools, trace } = opts;
  const executor = opts.executor ?? defaultExecutor;
  const maxRounds = opts.maxRounds ?? 8;
  let finalText = "";
  let lastRoundFailed = false;
  let nudgesLeft = opts.nudgeAfterError ?? 0;

  for (let round = 0; round < maxRounds; round++) {
    const res = await mistral.chat.complete({
      model,
      messages,
      tools,
      toolChoice: round === 0 && (opts.forceFirstTool ?? true) ? "any" : "auto",
      temperature: opts.temperature ?? 0.2,
    });

    const choice = res.choices[0];
    const assistant = choice?.message;
    if (!assistant) throw new Error("Mistral returned no message");

    messages.push({
      role: "assistant",
      content: assistant.content ?? "",
      toolCalls: assistant.toolCalls ?? undefined,
    });
    finalText = contentToText(assistant.content);

    const calls = assistant.toolCalls ?? [];
    if (calls.length === 0 || choice.finishReason !== "tool_calls") {
      if (lastRoundFailed && nudgesLeft > 0) {
        nudgesLeft -= 1;
        messages.push({
          role: "user",
          content:
            "Your last tool call failed, so you have no data for that part of the question. Do not answer from memory or invent values: fix the query (check the error message, field names and available functions) and run it again. If it cannot be done, say so explicitly.",
        });
        continue;
      }
      break;
    }

    const results = await Promise.all(
      calls.map(async (call) => {
        const name = call.function.name;
        const args = parseToolArgs(call);
        const started = Date.now();
        let result: unknown;
        let summary: string;
        try {
          if (!executor.isTool(name)) throw new Error(`Unknown tool: ${name}`);
          result = await executor.execute(name, args);
          summary = executor.summarize(name, result);
        } catch (err) {
          result = { error: err instanceof Error ? err.message : String(err) };
          summary = `error: ${(result as { error: string }).error}`;
        }
        trace.push({ tool: name, args, result_summary: summary, ms: Date.now() - started, ...(opts.includeResults ? { result } : {}) });
        return { call, result };
      }),
    );
    lastRoundFailed = results.some(({ result }) => typeof result === "object" && result !== null && "error" in result);

    for (const { call, result } of results) {
      messages.push({
        role: "tool",
        name: call.function.name,
        toolCallId: call.id,
        content: JSON.stringify(result),
      });
    }
  }
  return finalText;
}
