import { EVENT_TYPE, type AgentEvent, type AgentRunRequestedPayload } from "../events/types";
import type { StreamEntry } from "../events/redis-stream";
import type { ChatMessageService } from "../services/chat/message-service";
import type { ChatRunService, RunStatus } from "../services/chat/run-service";
import type { RunLoopEventService } from "../services/chat/loop-event-service";
import { createFallbackChatLlmService, type ChatLlmService } from "../services/chat/llm-service";
import { AgentLoop } from "./agent-loop";

export interface RuntimeEventBus {
  publish(event: AgentEvent): Promise<void>;
  ensureConsumerGroup(groupName: string): Promise<void>;
  readGroup(
    groupName: string,
    consumerName: string,
    options?: { blockMs?: number; count?: number },
  ): Promise<StreamEntry[]>;
  acknowledge(groupName: string, streamEntryId: string): Promise<void>;
}

const GENERIC_RUNTIME_ERROR_MESSAGE = "Agent runtime failed to process the request.";
const DEFAULT_MODEL = "gpt-4o-mini";

interface AgentRuntimeOptions {
  bus: RuntimeEventBus;
  messageService?: ChatMessageService;
  runService?: ChatRunService;
  runLoopEventService: RunLoopEventService;
  llmService?: ChatLlmService;
  consumerGroup: string;
  consumerName: string;
  defaultModel?: string;
  recentMessageCount?: number;
  logger?: Pick<Console, "info" | "error">;
}

export class AgentRuntime {
  private readonly bus: RuntimeEventBus;
  private readonly messageService?: ChatMessageService;
  private readonly runService?: ChatRunService;
  private readonly consumerGroup: string;
  private readonly consumerName: string;
  private readonly agentLoop: AgentLoop;
  private readonly logger: Pick<Console, "info" | "error">;
  private isRunning = false;

  public constructor(options: AgentRuntimeOptions) {
    this.bus = options.bus;
    this.messageService = options.messageService;
    this.runService = options.runService;
    this.consumerGroup = options.consumerGroup;
    this.consumerName = options.consumerName;
    this.logger = options.logger ?? console;

    const llmService = options.llmService ?? createFallbackChatLlmService();
    const defaultModel = options.defaultModel ?? DEFAULT_MODEL;

    this.agentLoop = new AgentLoop({
      llmService,
      messageService: options.messageService,
      defaultModel,
      recentMessageCount: options.recentMessageCount,
      runLoopEventService: options.runLoopEventService,
    });
  }

  public async init() {
    await this.bus.ensureConsumerGroup(this.consumerGroup);
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

  public async processOnce() {
    const entries = await this.bus.readGroup(this.consumerGroup, this.consumerName);
    if (entries.length === 0) {
      return 0;
    }

    for (const entry of entries) {
      await this.processEntry(entry.streamEntryId, entry.event);
    }

    return entries.length;
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

  private async processEntry(streamEntryId: string, event: AgentEvent) {
    if (event.type !== EVENT_TYPE.AGENT_RUN_REQUESTED) {
      await this.bus.acknowledge(this.consumerGroup, streamEntryId);
      return;
    }

    const requestedEvent = event as AgentEvent<typeof EVENT_TYPE.AGENT_RUN_REQUESTED>;
    const payload = requestedEvent.payload as AgentRunRequestedPayload;

    try {
      await this.updateRunStatus(payload.runId, "processing");
      const completedEvent = await this.buildCompletedEvent(requestedEvent);
      await this.persistAssistantMessage(requestedEvent, completedEvent.payload.output);
      await this.bus.publish(completedEvent);
      await this.updateRunStatus(payload.runId, "completed");

      this.logger.info("runtime.event.processed", {
        eventId: event.id,
        correlationId: event.correlationId,
      });
    } catch {
      const failedEvent = this.buildFailedEvent(requestedEvent);
      await this.bus.publish(failedEvent);
      await this.updateRunStatus(payload.runId, "failed", GENERIC_RUNTIME_ERROR_MESSAGE);

      this.logger.error("runtime.event.failed", {
        eventId: event.id,
        correlationId: event.correlationId,
      });
    } finally {
      await this.bus.acknowledge(this.consumerGroup, streamEntryId);
    }
  }

  private async updateRunStatus(runId: string, status: RunStatus, safeError?: string) {
    if (!this.runService) {
      return;
    }

    await this.runService.updateRunStatus({
      runId,
      status,
      safeError,
    });
  }

  private async buildCompletedEvent(event: AgentEvent<typeof EVENT_TYPE.AGENT_RUN_REQUESTED>) {
    const payload = event.payload;

    if (payload.simulateFailure) {
      throw new Error("Simulated runtime failure");
    }

    const loopResult = await this.agentLoop.run({
      runId: payload.runId,
      threadId: payload.threadId,
      correlationId: event.correlationId,
      prompt: payload.prompt,
      model: payload.model,
    });

    if (loopResult.reason !== "success" || !loopResult.output) {
      throw new Error(loopResult.error ?? `Agent loop stopped: ${loopResult.reason}`);
    }

    return {
      id: crypto.randomUUID(),
      type: EVENT_TYPE.AGENT_RUN_COMPLETED,
      timestamp: new Date().toISOString(),
      correlationId: event.correlationId,
      payload: {
        requestEventId: event.id,
        output: loopResult.output,
      },
    };
  }

  private async persistAssistantMessage(
    event: AgentEvent<typeof EVENT_TYPE.AGENT_RUN_REQUESTED>,
    output: string,
  ) {
    if (!this.messageService) {
      return;
    }

    const payload = event.payload as AgentRunRequestedPayload;

    await this.messageService.createAssistantMessage({
      threadId: payload.threadId,
      content: output,
      correlationId: event.correlationId,
    });
  }

  private buildFailedEvent(event: AgentEvent<typeof EVENT_TYPE.AGENT_RUN_REQUESTED>) {
    return {
      id: crypto.randomUUID(),
      type: EVENT_TYPE.AGENT_RUN_FAILED,
      timestamp: new Date().toISOString(),
      correlationId: event.correlationId,
      payload: {
        requestEventId: event.id,
        error: GENERIC_RUNTIME_ERROR_MESSAGE,
      },
    };
  }
}
