import type { LlmService } from "../modules/llm/llm-schemas";
import type { MessageService } from "../modules/messages/messages-schemas";
import type { RunService, RunStatus } from "../modules/runs/runs-schemas";
import type { AssistantModelMessage, ToolModelMessage } from "ai";
import { AgentLoop } from "./agent-loop";
import {
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_MODEL,
  DEFAULT_RECENT_MESSAGES_COUNT,
} from "../lib/constants";
import type { EventBus } from "../event-bus/redis-stream";
import { EVENT_TYPE, type RunEvent } from "../event-bus/types";

interface AgentRuntimeOptions {
  eventBus: EventBus;
  messageService: MessageService;
  runService: RunService;
  llmService: LlmService;
  consumerGroup: string;
  consumerName: string;
  model?: string;
  recentMessageCount?: number;
  maxIterations?: number;
  logger?: Pick<Console, "info" | "error">;
}

export class AgentRuntime {
  private readonly eventBus: EventBus;
  private readonly messageService: MessageService;
  private readonly runService: RunService;
  private readonly consumerGroup: string;
  private readonly consumerName: string;
  private readonly agentLoop: AgentLoop;
  private readonly logger: Pick<Console, "info" | "error">;
  private isRunning = false;

  public constructor(options: AgentRuntimeOptions) {
    this.eventBus = options.eventBus;
    this.messageService = options.messageService;
    this.runService = options.runService;
    this.consumerGroup = options.consumerGroup;
    this.consumerName = options.consumerName;
    this.logger = options.logger ?? console;

    const model = options.model ?? DEFAULT_MODEL;
    const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const recentMessageCount = options.recentMessageCount ?? DEFAULT_RECENT_MESSAGES_COUNT;

    this.agentLoop = new AgentLoop({
      llmService: options.llmService,
      model,
      maxIterations,
    });

    this.recentMessageCount = recentMessageCount;
  }

  private readonly recentMessageCount: number;

  public async init() {
    await this.eventBus.ensureConsumerGroup(this.consumerGroup);
  }

  public start() {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    void this.poll();
  }

  public stop() {
    this.isRunning = false;
  }

  private async poll() {
    while (this.isRunning) {
      try {
        await this.processOnce();
      } catch (error) {
        this.logger.error("runtime.poll.error", {
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }
  }

  public async processOnce() {
    const entries = await this.eventBus.readGroup(this.consumerGroup, this.consumerName);
    if (entries.length === 0) {
      return 0;
    }

    for (const entry of entries) {
      await this.processEntry(entry.streamEntryId, entry.event);
    }

    return entries.length;
  }

  private async processEntry(streamEntryId: string, event: RunEvent) {
    if (event.type !== EVENT_TYPE.AGENT_RUN_REQUESTED) {
      await this.eventBus.acknowledge(this.consumerGroup, streamEntryId);
      return;
    }

    const requestedEvent = event;
    const payload = requestedEvent.payload;

    try {
      await this.updateRunStatus(payload.runId, "processing");
      const completedEvent = await this.buildCompletedEvent(requestedEvent);
      await this.eventBus.publish(completedEvent);
      await this.updateRunStatus(payload.runId, "completed");
      this.logger.info("runtime.event.processed", {
        eventId: event.id,
      });
    } catch (error) {
      const safeError = this.getSafeErrorMessage(error);
      const failedEvent = this.buildFailedEvent(requestedEvent, safeError);
      await this.eventBus.publish(failedEvent);
      await this.updateRunStatus(payload.runId, "failed", safeError);
      this.logger.error("runtime.event.failed", {
        eventId: event.id,
      });
    } finally {
      await this.eventBus.acknowledge(this.consumerGroup, streamEntryId);
    }
  }

  private async updateRunStatus(runId: string, status: RunStatus, error?: string) {
    await this.runService.updateRunStatus({
      runId,
      status,
      error,
    });
  }

  private async buildCompletedEvent(event: RunEvent<typeof EVENT_TYPE.AGENT_RUN_REQUESTED>) {
    const payload = event.payload;

    const recentMessages = await this.messageService.listMessagesByThreadId(
      payload.threadId,
      this.recentMessageCount,
    );
    const promptMessages = recentMessages.length > 0 ? recentMessages : [payload.message];

    const loopResult = await this.agentLoop.run(
      {
        runId: payload.runId,
        threadId: payload.threadId,
        messages: promptMessages,
      },
      {
        onEvent: async (loopEvent) => {
          if (loopEvent.type !== "assistant.generated") {
            return;
          }

          await this.messageService.createAssistantMessage({
            threadId: loopEvent.payload.threadId,
            content: this.getPersistedMessageContent(loopEvent.payload.response.message),
          });
        },
      },
    );

    if (loopResult.reason === "error") {
      throw new Error(loopResult.error ?? "unknown");
    }

    return {
      id: crypto.randomUUID(),
      type: EVENT_TYPE.AGENT_RUN_COMPLETED,
      timestamp: new Date().toISOString(),
      payload: {
        requestEventId: event.id,
        runId: payload.runId,
        threadId: payload.threadId,
      },
    };
  }

  private buildFailedEvent(
    event: RunEvent<typeof EVENT_TYPE.AGENT_RUN_REQUESTED>,
    safeError: string,
  ) {
    return {
      id: crypto.randomUUID(),
      type: EVENT_TYPE.AGENT_RUN_FAILED,
      timestamp: new Date().toISOString(),
      payload: {
        requestEventId: event.id,
        runId: event.payload.runId,
        threadId: event.payload.threadId,
        error: safeError,
      },
    };
  }

  private getSafeErrorMessage(error: unknown) {
    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message;
    }

    return "unknown";
  }

  private getAssistantMessageText(message: AssistantModelMessage) {
    if (typeof message.content === "string") {
      return message.content;
    }

    const textContent = message.content
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n")
      .trim();

    return textContent.length > 0 ? textContent : "No content";
  }

  private getPersistedMessageContent(message: AssistantModelMessage | ToolModelMessage) {
    if (message.role === "assistant") {
      return this.getAssistantMessageText(message);
    }

    const toolCalls = message.content
      .flatMap((part) => {
        if (part.type !== "tool-result") {
          return [];
        }

        const payload = this.getToolPayload(part.output);

        return [
          {
            toolName: part.toolName,
            args: payload?.args ?? null,
            output: payload?.output ?? part.output,
          },
        ];
      })
      .filter((entry) => entry.toolName.length > 0);

    return JSON.stringify(toolCalls);
  }

  private getToolPayload(output: unknown) {
    if (!this.isRecord(output) || output.type !== "text") {
      return undefined;
    }

    if (typeof output.value !== "string") {
      return undefined;
    }

    const parsedPayload = this.safeJsonParse(output.value);
    if (!this.isRecord(parsedPayload)) {
      return undefined;
    }

    return {
      args: parsedPayload.args,
      output: parsedPayload.output,
    };
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  private safeJsonParse(value: string) {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }
}
