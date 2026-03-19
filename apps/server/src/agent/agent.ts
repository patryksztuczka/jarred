import { openai } from "@ai-sdk/openai";
import {
  Output,
  streamText,
  type AssistantModelMessage,
  type ModelMessage,
  type ToolModelMessage,
  type ToolSet,
} from "ai";
import { z } from "zod";

import type { AgentEvent, AgentStopReason } from "./agent-event";

const assistantOutputSchema = z.object({
  action: z.enum(["continue", "finish"]),
  response: z.string().min(1).nullable(),
});

interface AgentOptions {
  systemPrompt: string;
  model: string;
  tools?: ToolSet;
  maxIterations?: number;
}

export interface AgentRunResult {
  reason: AgentStopReason;
  error?: string;
}

type AgentListener = (event: AgentEvent) => void;

export class Agent {
  private readonly systemPrompt: string;
  private readonly model: string;
  private readonly tools: ToolSet;
  private readonly maxIterations: number;
  private readonly listeners = new Set<AgentListener>();

  constructor(options: AgentOptions) {
    this.systemPrompt = options.systemPrompt;
    this.model = options.model;
    this.tools = options.tools ?? {};
    this.maxIterations = options.maxIterations ?? 5;
  }

  subscribe(listener: AgentListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async run(messages: ModelMessage[]): Promise<AgentRunResult> {
    this.emit({ type: "agent.start", model: this.model });

    try {
      const promptMessages: ModelMessage[] = this.buildPromptMessages(messages);
      let iterationsCalled = 0;
      let lastAction: "continue" | "finish" = "continue";

      while (iterationsCalled < this.maxIterations && lastAction === "continue") {
        const iteration = iterationsCalled + 1;
        const reportedToolCallIds = new Set<string>();

        const result = streamText({
          model: openai(this.model),
          messages: promptMessages,
          output: Output.object({ schema: assistantOutputSchema }),
          tools: this.tools,
          experimental_telemetry: { isEnabled: true },
          onChunk: ({ chunk }) => {
            if (chunk.type !== "tool-call") {
              return;
            }

            if (reportedToolCallIds.has(chunk.toolCallId)) {
              return;
            }

            reportedToolCallIds.add(chunk.toolCallId);
            this.emit({ type: "tool.start", toolName: chunk.toolName, iteration });
          },
        });

        // Stream partial text deltas
        let streamedResponse = "";
        for await (const partialOutput of result.partialOutputStream) {
          const partialResponse = this.getPartialResponseText(partialOutput);
          if (!partialResponse || partialResponse.length <= streamedResponse.length) {
            continue;
          }

          const delta = partialResponse.slice(streamedResponse.length);
          streamedResponse = partialResponse;
          this.emit({ type: "agent.token", delta, iteration });
        }

        // Get the full response messages (assistant + tool results if any)
        const response = await result.response;
        const toolResults = await result.toolResults;
        const toolResult = toolResults.at(0);

        if (toolResult) {
          // Push all response messages (assistant with tool_calls + tool results)
          for (const msg of response.messages) {
            promptMessages.push(msg);
          }
          this.emit({ type: "tool.end", toolName: toolResult.toolName, result: toolResult.output, iteration });
          // Emit message.complete for the tool result message (last in response.messages)
          const toolMessage = response.messages.at(-1);
          if (toolMessage) {
            this.emit({ type: "message.complete", message: toolMessage as ToolModelMessage });
          }
          lastAction = "continue";
        } else {
          const output = await result.output;
          const assistantMessage = this.buildAssistantMessage(output.response);
          promptMessages.push(assistantMessage);
          this.emit({ type: "message.complete", message: assistantMessage });
          lastAction = output.action;
        }

        iterationsCalled += 1;
      }

      const reason: AgentStopReason = lastAction === "finish" ? "finish" : "max_iterations";
      this.emit({ type: "agent.end", reason });
      return { reason };
    } catch (error) {
      const safeError = error instanceof Error ? error.message : "unknown";
      this.emit({ type: "agent.end", reason: "error", error: safeError });
      return { reason: "error", error: safeError };
    }
  }

  private buildPromptMessages(messages: ModelMessage[]): ModelMessage[] {
    const result: ModelMessage[] = [];

    if (this.systemPrompt) {
      result.push({ role: "system", content: this.systemPrompt });
    }

    result.push(...messages);
    return result;
  }

  private getPartialResponseText(partialOutput: unknown): string | undefined {
    if (!partialOutput || typeof partialOutput !== "object") {
      return undefined;
    }

    const response = (partialOutput as { response?: unknown }).response;
    if (typeof response !== "string") {
      return undefined;
    }

    return response;
  }

  private buildToolMessage(toolResult: {
    toolCallId: string;
    toolName: string;
    input: unknown;
    output: unknown;
  }): ToolModelMessage {
    const toolPayload = JSON.stringify({
      args: toolResult.input,
      output: toolResult.output,
    });

    return {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: toolResult.toolCallId,
          toolName: toolResult.toolName,
          output: {
            type: "text",
            value: toolPayload,
          },
        },
      ],
    };
  }

  private buildAssistantMessage(response: string | null): AssistantModelMessage {
    return {
      role: "assistant",
      content: response ?? "No content",
    };
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
