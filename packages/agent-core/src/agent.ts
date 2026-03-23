import { openai } from "@ai-sdk/openai";
import {
  streamText,
  type AssistantModelMessage,
  type ModelMessage,
  type ToolModelMessage,
  type ToolSet,
} from "ai";

import type { AgentEvent, AgentStopReason } from "./agent-event";

const DEFAULT_MAX_ITERATIONS = 5;
const DEFAULT_MODEL = "gpt-5-nano";

export interface AgentRunResult {
  reason: AgentStopReason;
  error?: string;
}

export interface AgentRunInput {
  messages: ModelMessage[];
}

type AgentListener = (event: AgentEvent) => void;

export type AgentState = {
  systemPrompt?: string;
  messages: ModelMessage[];
  model: string;
  tools: ToolSet;
  isRunning: boolean;
};

export interface AgentOptions {
  initialState: Partial<Omit<AgentState, "isRunning">>;
  maxIterations?: number;
  telemetry?: boolean;
}

export class Agent {
  private readonly state: AgentState = {
    systemPrompt: "",
    messages: [],
    model: DEFAULT_MODEL,
    tools: {},
    isRunning: false,
  };
  private readonly maxIterations: number = DEFAULT_MAX_ITERATIONS;
  private readonly telemetry: boolean = false;
  private readonly listeners = new Set<AgentListener>();

  constructor(options: AgentOptions) {
    this.state = { ...this.state, ...options.initialState };
    this.maxIterations = options.maxIterations ?? this.maxIterations;
    this.telemetry = options.telemetry ?? this.telemetry;
  }

  subscribe(listener: AgentListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setModel(model: string) {
    this.state.model = model;
  }

  setMessages(messages: ModelMessage[]) {
    this.state.messages = messages;
  }

  appendMessages(messages: ModelMessage[]) {
    this.state.messages.push(...messages);
  }

  clearMessages() {
    this.state.messages = [];
  }

  public async prompt(input: string | ModelMessage | ModelMessage[]) {
    let contexMessages = this.state.messages.slice();
    let prompt: ModelMessage[];
    if (Array.isArray(input)) {
      prompt = input;
    } else if (typeof input === "string") {
      prompt = [
        {
          role: "user",
          content: input,
        },
      ];
    } else {
      prompt = [input];
    }

    const context = {
      model: this.state.model,
      systemPrompt: this.state.systemPrompt,
      prompt,
      messages: contexMessages,
    };

    const result = await this.runLoop(context);

    if (result.reason === "finish" || result.reason === "max_iterations") {
      this.appendMessages(result.messages);
    }
  }

  private async runLoop(context: {
    model: string;
    systemPrompt?: string;
    prompt: ModelMessage[];
    messages: ModelMessage[];
  }) {
    try {
      this.emit({ type: "agent.start", model: this.state.model });
      let iterationsCalled = 0;
      let lastMessageType: "tool" | "agent" | undefined;
      const turnMessages: ModelMessage[] = context.prompt;

      while (iterationsCalled < this.maxIterations && lastMessageType !== "agent") {
        const iteration = iterationsCalled + 1;
        const reportedToolCallIds = new Set<string>();

        const result = streamText({
          model: openai(context.model),
          messages: [
            ...(context.systemPrompt
              ? ([{ role: "system", content: context.systemPrompt }] as const)
              : []),
            ...context.messages,
            ...turnMessages,
          ],
          tools: this.state.tools,
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
          const delta = partialOutput.slice(streamedResponse.length);
          streamedResponse = partialOutput;
          this.emit({ type: "agent.token", delta, iteration });
        }

        const response = await result.response;
        const toolResult = (await result.toolResults).at(0);

        if (toolResult) {
          for (const message of response.messages) {
            turnMessages.push(message);
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

          lastMessageType = "tool";
        } else {
          const output = await result.output;
          const agentMessage: AssistantModelMessage = {
            role: "assistant",
            content: output,
          };
          turnMessages.push(agentMessage);
          this.emit({ type: "message.complete", message: agentMessage });
          lastMessageType = "agent";
        }

        iterationsCalled += 1;
      }

      const reason: AgentStopReason = lastMessageType === "agent" ? "finish" : "max_iterations";
      this.emit({ type: "agent.end", reason });
      return { reason, messages: turnMessages };
    } catch (error) {
      const safeError = error instanceof Error ? error.message : "unknown";
      this.emit({ type: "agent.end", reason: "error", error: safeError });
      return { reason: "error" as AgentStopReason, error: safeError, messages: [] };
    }
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
