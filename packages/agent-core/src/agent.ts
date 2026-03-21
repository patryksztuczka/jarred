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

const agentOutputSchema = z.object({
  action: z.enum(["continue", "finish"]),
  response: z.string().min(1).nullable(),
});

const DEFAULT_MAX_ITERATIONS = 5;

export interface AgentOptions {
  instructions?: string;
  systemPrompt?: string;
  model: string;
  tools?: ToolSet;
  maxIterations?: number;
  telemetry?: boolean;
  initialState?: Partial<Pick<AgentState, "messages" | "model">>;
}

export interface AgentRunResult {
  reason: AgentStopReason;
  error?: string;
}

export interface AgentRunInput {
  messages: ModelMessage[];
}

export interface AgentState {
  messages: ModelMessage[];
  model: string;
  isRunning: boolean;
  error?: string;
  stopReason?: AgentStopReason;
}

type AgentListener = (event: AgentEvent) => void;

export class Agent {
  private instructions: string;
  private readonly tools: ToolSet;
  private readonly maxIterations: number;
  private readonly telemetry: boolean;
  private readonly listeners = new Set<AgentListener>();
  readonly state: AgentState;

  constructor(options: AgentOptions) {
    this.instructions = options.instructions ?? options.systemPrompt ?? "";
    this.tools = options.tools ?? {};
    this.maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    this.telemetry = options.telemetry ?? false;
    this.state = {
      messages: options.initialState?.messages ?? [],
      model: options.initialState?.model ?? options.model,
      isRunning: false,
    };
  }

  subscribe(listener: AgentListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setInstructions(instructions: string | undefined) {
    this.instructions = instructions ?? "";
  }

  setModel(model: string) {
    this.state.model = model;
  }

  setMessages(messages: ModelMessage[]) {
    this.state.messages = messages;
  }

  appendMessage(message: ModelMessage) {
    this.state.messages.push(message);
  }

  clearMessages() {
    this.state.messages = [];
  }

  async run(input?: AgentRunInput | ModelMessage[]): Promise<AgentRunResult> {
    const messages = input ? (Array.isArray(input) ? input : input.messages) : this.state.messages;
    const conversationMessages = [...messages];

    this.state.messages = conversationMessages;
    this.state.isRunning = true;
    this.state.error = undefined;
    this.state.stopReason = undefined;

    this.emit({ type: "agent.start", model: this.state.model });

    try {
      let iterationsCalled = 0;
      let lastAction: "continue" | "finish" = "continue";

      while (iterationsCalled < this.maxIterations && lastAction === "continue") {
        const iteration = iterationsCalled + 1;
        const reportedToolCallIds = new Set<string>();

        const result = streamText({
          model: openai(this.state.model),
          messages: this.buildPromptMessages(conversationMessages),
          output: Output.object({ schema: agentOutputSchema }),
          tools: this.tools,
          experimental_telemetry: this.telemetry ? { isEnabled: true } : undefined,
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

        const response = await result.response;
        const toolResults = await result.toolResults;
        const toolResult = toolResults.at(0);

        if (toolResult) {
          for (const message of response.messages) {
            conversationMessages.push(message);
          }

          this.emit({
            type: "tool.end",
            toolName: toolResult.toolName,
            result: toolResult.output,
            iteration,
          });

          const toolMessage = response.messages.at(-1);
          if (toolMessage) {
            this.emit({ type: "message.complete", message: toolMessage as ToolModelMessage });
          }

          lastAction = "continue";
        } else {
          const output = await result.output;
          const agentMessage = this.buildAgentMessage(output.response);
          conversationMessages.push(agentMessage);
          this.emit({ type: "message.complete", message: agentMessage });
          lastAction = output.action;
        }

        iterationsCalled += 1;
      }

      const reason: AgentStopReason = lastAction === "finish" ? "finish" : "max_iterations";
      this.state.stopReason = reason;
      this.emit({ type: "agent.end", reason });
      return { reason };
    } catch (error) {
      const safeError = error instanceof Error ? error.message : "unknown";
      this.state.error = safeError;
      this.state.stopReason = "error";
      this.emit({ type: "agent.end", reason: "error", error: safeError });
      return { reason: "error", error: safeError };
    } finally {
      this.state.isRunning = false;
    }
  }

  private buildPromptMessages(messages: ModelMessage[]): ModelMessage[] {
    const result: ModelMessage[] = [];

    if (this.instructions) {
      result.push({ role: "system", content: this.instructions });
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

  private buildAgentMessage(response: string | null): AssistantModelMessage {
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
