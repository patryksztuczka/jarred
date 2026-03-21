import type { AssistantModelMessage, ModelMessage, ToolModelMessage, ToolSet } from "ai";

import { Agent, type AgentEvent, type AgentStopReason } from "@jarred/agent-core";

const DEFAULT_MODEL = "gpt-5-nano";
const DEFAULT_MAX_ITERATIONS = 5;

export interface AgentSessionOptions {
  tools: ToolSet;
  systemPrompt?: string | Promise<string | undefined>;
  initialMessages?: ModelMessage[];
  initialModel?: string;
  defaultModel?: string;
  maxIterations?: number;
  telemetry?: boolean;
}

export interface AgentSessionPromptOptions {
  runId: string;
  sessionId: string;
  model?: string;
}

type SessionEventMeta = {
  runId: string;
  sessionId: string;
};

type SessionScopedAgentEvent =
  | ({ type: "agent.start"; model: string } & SessionEventMeta)
  | ({ type: "agent.token"; delta: string; iteration: number } & SessionEventMeta)
  | ({ type: "tool.start"; toolName: string; iteration: number } & SessionEventMeta)
  | ({ type: "tool.end"; toolName: string; result: unknown; iteration: number } & SessionEventMeta)
  | ({
      type: "message.complete";
      message: AssistantModelMessage | ToolModelMessage;
    } & SessionEventMeta)
  | ({ type: "agent.end"; reason: AgentStopReason; error?: string } & SessionEventMeta);

export type AgentSessionEvent =
  | SessionScopedAgentEvent
  | ({ type: "session.start"; model: string } & SessionEventMeta)
  | ({ type: "session.complete"; reason: AgentStopReason } & SessionEventMeta)
  | ({ type: "session.error"; error: string } & SessionEventMeta);

type AgentSessionListener = (event: AgentSessionEvent) => void | Promise<void>;

export class AgentSession {
  private readonly systemPrompt?: string | Promise<string | undefined>;
  private readonly listeners = new Set<AgentSessionListener>();
  readonly agent: Agent;

  constructor(options: AgentSessionOptions) {
    const model = options.initialModel ?? options.defaultModel ?? DEFAULT_MODEL;

    this.systemPrompt = options.systemPrompt;
    this.agent = new Agent({
      model,
      tools: options.tools,
      maxIterations: options.maxIterations ?? DEFAULT_MAX_ITERATIONS,
      telemetry: options.telemetry ?? false,
      initialState: {
        messages: options.initialMessages,
        model,
      },
    });
  }

  subscribe(listener: AgentSessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async prompt(input: string, options: AgentSessionPromptOptions) {
    const { runId, sessionId } = options;
    const model = options.model ?? this.agent.state.model;
    let unsubscribe: (() => void) | undefined;

    this.agent.appendMessage({
      role: "user",
      content: input,
    });
    this.agent.setModel(model);
    this.emit({ type: "session.start", runId, sessionId, model });

    try {
      this.agent.setInstructions(await this.systemPrompt);

      unsubscribe = this.agent.subscribe((event) => {
        this.handleAgentEvent(event, { runId, sessionId });
      });

      const result = await this.agent.run();

      if (result.reason === "error") {
        this.emit({
          type: "session.error",
          runId,
          sessionId,
          error: result.error ?? "unknown",
        });
        return;
      }

      this.emit({ type: "session.complete", runId, sessionId, reason: result.reason });
    } catch (error) {
      const safeError = error instanceof Error ? error.message : "unknown";
      this.emit({ type: "session.error", runId, sessionId, error: safeError });
    } finally {
      unsubscribe?.();
    }
  }

  private handleAgentEvent(event: AgentEvent, meta: SessionEventMeta) {
    this.emit({
      ...event,
      ...meta,
    } as SessionScopedAgentEvent);
  }

  private emit(event: AgentSessionEvent): void {
    for (const listener of this.listeners) {
      try {
        const result = listener(event);
        if (result instanceof Promise) {
          void result.catch(() => {});
        }
      } catch {
        // Ignore listener errors to keep event forwarding fast and non-blocking.
      }
    }
  }
}
