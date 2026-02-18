import { describe, expect, test } from "bun:test";
import { EVENT_TYPE, type AgentEvent } from "../../../src/events/types";
import type { ChatMessageService } from "../../../src/services/chat/message-service";
import type { ChatLlmService } from "../../../src/services/chat/llm-service";
import type { ChatRunService, RunStatus } from "../../../src/services/chat/run-service";
import type { RunLoopEventService } from "../../../src/services/chat/loop-event-service";
import { createInMemoryRunLoopEventService } from "../../../src/services/chat/loop-event-service";
import { AgentRuntime, type RuntimeEventBus } from "../../../src/runtime/agent-runtime";

class FakeRuntimeBus implements RuntimeEventBus {
  public readonly published: AgentEvent[] = [];
  public readonly acknowledged: Array<{ groupName: string; streamEntryId: string }> = [];
  public readonly queuedEntries: Array<{ streamEntryId: string; event: AgentEvent }> = [];

  public async publish(event: AgentEvent) {
    this.published.push(event);
  }

  public async ensureConsumerGroup(groupName: string) {
    void groupName;
    return;
  }

  public async readGroup() {
    const next = this.queuedEntries.shift();
    return next ? [next] : [];
  }

  public async acknowledge(groupName: string, streamEntryId: string) {
    this.acknowledged.push({ groupName, streamEntryId });
  }
}

describe("AgentRuntime", () => {
  test("sets run status to processing then completed on success", async () => {
    const bus = new FakeRuntimeBus();
    bus.queuedEntries.push({
      streamEntryId: "0-3",
      event: {
        id: "evt_req_run_success_1",
        type: EVENT_TYPE.AGENT_RUN_REQUESTED,
        timestamp: "2026-01-01T00:00:00.000Z",
        correlationId: "corr_run_success_1",
        payload: {
          runId: "run_success_1",
          threadId: "thr_abcdefghijklmnopqrstuvwx",
          prompt: "hello run status",
          model: "gpt-4o-mini",
        },
      },
    });

    const statuses: RunStatus[] = [];
    const runService: ChatRunService = {
      createQueuedRun: async () => {
        throw new Error("createQueuedRun should not be called in runtime test");
      },
      updateRunStatus: async (input) => {
        statuses.push(input.status);

        return {
          id: input.runId,
          threadId: "thr_abcdefghijklmnopqrstuvwx",
          correlationId: "corr_run_success_1",
          status: input.status,
          safeError: input.safeError,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:01.000Z",
        };
      },
      getRunById: async () => {
        return undefined;
      },
    };

    const runtime = new AgentRuntime({
      bus,
      runService,
      runLoopEventService: createInMemoryRunLoopEventService(),
      consumerGroup: "group_run_success",
      consumerName: "consumer_run_success",
      logger: { info: () => {}, error: () => {} },
    });

    const processed = await runtime.processOnce();

    expect(processed).toBe(1);
    expect(statuses).toEqual(["processing", "completed"]);
  });

  test("sets run status to processing then failed with safe error", async () => {
    const bus = new FakeRuntimeBus();
    bus.queuedEntries.push({
      streamEntryId: "0-4",
      event: {
        id: "evt_req_run_fail_1",
        type: EVENT_TYPE.AGENT_RUN_REQUESTED,
        timestamp: "2026-01-01T00:00:00.000Z",
        correlationId: "corr_run_fail_1",
        payload: {
          runId: "run_fail_1",
          threadId: "thr_abcdefghijklmnopqrstuvwx",
          prompt: "hello run status fail",
          model: "gpt-4o-mini",
          simulateFailure: true,
        },
      },
    });

    const statusUpdates: Array<{ status: RunStatus; safeError?: string }> = [];
    const runService: ChatRunService = {
      createQueuedRun: async () => {
        throw new Error("createQueuedRun should not be called in runtime test");
      },
      updateRunStatus: async (input) => {
        statusUpdates.push({
          status: input.status,
          safeError: input.safeError,
        });

        return {
          id: input.runId,
          threadId: "thr_abcdefghijklmnopqrstuvwx",
          correlationId: "corr_run_fail_1",
          status: input.status,
          safeError: input.safeError,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:01.000Z",
        };
      },
      getRunById: async () => {
        return undefined;
      },
    };

    const runtime = new AgentRuntime({
      bus,
      runService,
      runLoopEventService: createInMemoryRunLoopEventService(),
      consumerGroup: "group_run_fail",
      consumerName: "consumer_run_fail",
      logger: { info: () => {}, error: () => {} },
    });

    const processed = await runtime.processOnce();

    expect(processed).toBe(1);
    expect(statusUpdates).toEqual([
      {
        status: "processing",
        safeError: undefined,
      },
      {
        status: "failed",
        safeError: "Agent runtime failed to process the request.",
      },
    ]);
  });

  test("persists assistant message with thread and correlation from request flow", async () => {
    const bus = new FakeRuntimeBus();
    bus.queuedEntries.push({
      streamEntryId: "0-2",
      event: {
        id: "evt_req_persist_1",
        type: EVENT_TYPE.AGENT_RUN_REQUESTED,
        timestamp: "2026-01-01T00:00:00.000Z",
        correlationId: "corr_persist_1",
        payload: {
          runId: "run_persist_1",
          threadId: "thr_abcdefghijklmnopqrstuvwx",
          prompt: "hello persistence",
          model: "gpt-4o-mini",
        },
      },
    });

    const persistedAssistantMessages: Array<{
      threadId: string;
      content: string;
      correlationId: string;
    }> = [];

    const messageService: ChatMessageService = {
      createIncomingMessage: async (input) => {
        return {
          messageId: `msg_incoming_${input.correlationId}`,
          threadId: input.threadId,
        };
      },
      createAssistantMessage: async (input) => {
        persistedAssistantMessages.push(input);

        return {
          messageId: "msg_assistant_1",
          threadId: input.threadId,
        };
      },
      listMessagesByThreadId: async () => {
        return [];
      },
    };

    const runtime = new AgentRuntime({
      bus,
      messageService,
      runLoopEventService: createInMemoryRunLoopEventService(),
      consumerGroup: "group_persist",
      consumerName: "consumer_persist",
      logger: { info: () => {}, error: () => {} },
    });

    const processed = await runtime.processOnce();

    expect(processed).toBe(1);
    expect(persistedAssistantMessages).toEqual([
      {
        threadId: "thr_abcdefghijklmnopqrstuvwx",
        content: "Handled prompt: hello persistence",
        correlationId: "corr_persist_1",
      },
    ]);
    expect(bus.published).toHaveLength(1);
    expect(bus.published[0]?.type).toBe(EVENT_TYPE.AGENT_RUN_COMPLETED);
  });

  test("persists loop events including extended step schema", async () => {
    const bus = new FakeRuntimeBus();
    bus.queuedEntries.push({
      streamEntryId: "0-7",
      event: {
        id: "evt_req_loop_events_1",
        type: EVENT_TYPE.AGENT_RUN_REQUESTED,
        timestamp: "2026-01-01T00:00:00.000Z",
        correlationId: "corr_loop_events_1",
        payload: {
          runId: "run_loop_events_1",
          threadId: "thr_abcdefghijklmnopqrstuvwx",
          prompt: "Generate a concise answer",
          model: "gpt-4o-mini",
        },
      },
    });

    const loopEvents: Array<{
      eventType: string;
      hasInstruction?: boolean;
      iteration?: number;
    }> = [];

    const runLoopEventService: RunLoopEventService = {
      appendEvent: async (input) => {
        loopEvents.push({
          eventType: input.eventType,
          hasInstruction:
            typeof (input.payload as { step?: { instruction?: string } }).step?.instruction ===
            "string",
          iteration: input.iteration,
        });
      },
      listByRunId: async () => {
        return [];
      },
    };

    const runtime = new AgentRuntime({
      bus,
      runLoopEventService,
      consumerGroup: "group_loop_events",
      consumerName: "consumer_loop_events",
      logger: { info: () => {}, error: () => {} },
    });

    const processed = await runtime.processOnce();

    expect(processed).toBe(1);
    expect(loopEvents.some((event) => event.eventType === "loop.step.planned")).toBe(true);
    expect(loopEvents.some((event) => event.eventType === "loop.step.executed")).toBe(true);
    expect(loopEvents.some((event) => event.eventType === "loop.step.evaluated")).toBe(true);
    expect(loopEvents.some((event) => event.hasInstruction)).toBe(true);
  });

  test("uses summary plus recent memory and honors per-request model", async () => {
    const bus = new FakeRuntimeBus();
    bus.queuedEntries.push({
      streamEntryId: "0-6",
      event: {
        id: "evt_req_memory_1",
        type: EVENT_TYPE.AGENT_RUN_REQUESTED,
        timestamp: "2026-01-01T00:00:00.000Z",
        correlationId: "corr_memory_1",
        payload: {
          runId: "run_memory_1",
          threadId: "thr_abcdefghijklmnopqrstuvwx",
          prompt: "Now implement the plan",
          model: "gpt-4.1-mini",
        },
      },
    });

    const llmCalls: {
      summaryModel?: string;
      summaryMessages?: string[];
      responseModel?: string;
      responseMessages?: Array<{ role: string; content: string }>;
    } = {};

    const chatLlmService: ChatLlmService = {
      summarizeConversation: async (input) => {
        llmCalls.summaryModel = input.model;
        llmCalls.summaryMessages = input.messages.map((message) => message.content);
        return "Summary of earlier conversation";
      },
      generateAssistantResponse: async (input) => {
        llmCalls.responseModel = input.model;
        llmCalls.responseMessages = input.messages.map((message) => {
          return { role: message.role, content: message.content };
        });
        return "Implementation steps ready";
      },
      evaluateExecution: async () => {
        return {
          answer: "sufficient",
          feedback: "Output is acceptable.",
        };
      },
    };

    const messageService: ChatMessageService = {
      createIncomingMessage: async (input) => {
        return {
          messageId: `msg_incoming_${input.correlationId}`,
          threadId: input.threadId,
        };
      },
      createAssistantMessage: async (input) => {
        return {
          messageId: `msg_assistant_${input.correlationId}`,
          threadId: input.threadId,
        };
      },
      listMessagesByThreadId: async () => {
        return [
          {
            id: "msg_1",
            threadId: "thr_abcdefghijklmnopqrstuvwx",
            role: "user",
            content: "Build a migration plan",
            correlationId: "corr_1",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "msg_2",
            threadId: "thr_abcdefghijklmnopqrstuvwx",
            role: "assistant",
            content: "Start from schema changes",
            correlationId: "corr_1",
            createdAt: "2026-01-01T00:00:01.000Z",
          },
          {
            id: "msg_3",
            threadId: "thr_abcdefghijklmnopqrstuvwx",
            role: "user",
            content: "Also include rollback",
            correlationId: "corr_2",
            createdAt: "2026-01-01T00:00:02.000Z",
          },
          {
            id: "msg_4",
            threadId: "thr_abcdefghijklmnopqrstuvwx",
            role: "assistant",
            content: "Rollback included",
            correlationId: "corr_2",
            createdAt: "2026-01-01T00:00:03.000Z",
          },
          {
            id: "msg_5",
            threadId: "thr_abcdefghijklmnopqrstuvwx",
            role: "user",
            content: "Now implement the plan",
            correlationId: "corr_memory_1",
            createdAt: "2026-01-01T00:00:04.000Z",
          },
        ];
      },
    };

    const runtime = new AgentRuntime({
      bus,
      messageService,
      chatLlmService,
      runLoopEventService: createInMemoryRunLoopEventService(),
      consumerGroup: "group_memory",
      consumerName: "consumer_memory",
      summaryModel: "gpt-4o-mini",
      memoryRecentMessageCount: 2,
      logger: { info: () => {}, error: () => {} },
    });

    await runtime.processOnce();

    expect(llmCalls.summaryModel).toBe("gpt-4o-mini");
    expect(llmCalls.summaryMessages).toEqual([
      "Build a migration plan",
      "Start from schema changes",
      "Also include rollback",
    ]);
    expect(llmCalls.responseModel).toBe("gpt-4.1-mini");
    expect(llmCalls.responseMessages?.[0]?.role).toBe("system");
    expect(llmCalls.responseMessages?.[0]?.content).toContain("Execution instruction:");
    expect(llmCalls.responseMessages?.[1]?.role).toBe("system");
    expect(llmCalls.responseMessages?.[1]?.content).toContain("Summary of earlier conversation");
    expect(llmCalls.responseMessages?.slice(2)).toEqual([
      {
        role: "assistant",
        content: "Rollback included",
      },
      {
        role: "user",
        content: "Now implement the plan",
      },
    ]);
    expect(bus.published[0]?.type).toBe(EVENT_TYPE.AGENT_RUN_COMPLETED);
    expect(bus.published[0]?.payload).toEqual({
      requestEventId: "evt_req_memory_1",
      output: "Implementation steps ready",
    });
  });

  test("uses crypto ids for emitted events", async () => {
    const bus = new FakeRuntimeBus();
    bus.queuedEntries.push({
      streamEntryId: "0-1",
      event: {
        id: "evt_req_default_1",
        type: EVENT_TYPE.AGENT_RUN_REQUESTED,
        timestamp: "2026-01-01T00:00:00.000Z",
        correlationId: "corr_default_1",
        payload: {
          runId: "run_default_1",
          threadId: "thr_abcdefghijklmnopqrstuvwx",
          prompt: "hello default generator",
          model: "gpt-4o-mini",
        },
      },
    });

    const runtime = new AgentRuntime({
      bus,
      runLoopEventService: createInMemoryRunLoopEventService(),
      consumerGroup: "group_default",
      consumerName: "consumer_default",
      logger: { info: () => {}, error: () => {} },
    });

    const processed = await runtime.processOnce();

    expect(processed).toBe(1);
    expect(bus.published).toHaveLength(1);
    expect(typeof bus.published[0]?.id).toBe("string");
    expect(bus.published[0]?.id.length).toBeGreaterThan(0);
    expect(bus.published[0]?.type).toBe(EVENT_TYPE.AGENT_RUN_COMPLETED);
    expect(bus.acknowledged).toEqual([{ groupName: "group_default", streamEntryId: "0-1" }]);
  });

  test("processes agent.run.requested and emits completed event", async () => {
    const bus = new FakeRuntimeBus();
    bus.queuedEntries.push({
      streamEntryId: "1-0",
      event: {
        id: "evt_req_1",
        type: EVENT_TYPE.AGENT_RUN_REQUESTED,
        timestamp: "2026-01-01T00:00:00.000Z",
        correlationId: "corr_1",
        payload: {
          runId: "run_1",
          threadId: "thr_zyxwvutsrqponmlkjihgfedc",
          prompt: "hello",
          model: "gpt-4o-mini",
        },
      },
    });

    const runtime = new AgentRuntime({
      bus,
      runLoopEventService: createInMemoryRunLoopEventService(),
      consumerGroup: "group_a",
      consumerName: "consumer_a",
      logger: { info: () => {}, error: () => {} },
    });

    const processed = await runtime.processOnce();

    expect(processed).toBe(1);
    expect(bus.published).toHaveLength(1);
    expect(typeof bus.published[0]?.id).toBe("string");
    expect(bus.published[0]?.id.length).toBeGreaterThan(0);
    expect(typeof bus.published[0]?.timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(bus.published[0]?.timestamp ?? ""))).toBe(false);
    expect(bus.published[0]?.type).toBe(EVENT_TYPE.AGENT_RUN_COMPLETED);
    expect(bus.published[0]?.correlationId).toBe("corr_1");
    expect(bus.published[0]?.payload).toEqual({
      requestEventId: "evt_req_1",
      output: "Handled prompt: hello",
    });
    expect(bus.acknowledged).toEqual([{ groupName: "group_a", streamEntryId: "1-0" }]);
  });

  test("emits failed event when runtime logic errors", async () => {
    const bus = new FakeRuntimeBus();
    bus.queuedEntries.push({
      streamEntryId: "2-0",
      event: {
        id: "evt_req_2",
        type: EVENT_TYPE.AGENT_RUN_REQUESTED,
        timestamp: "2026-01-01T00:00:00.000Z",
        correlationId: "corr_2",
        payload: {
          runId: "run_2",
          threadId: "thr_abcdefghijklmnopqrstuvwx",
          prompt: "hello",
          model: "gpt-4o-mini",
          simulateFailure: true,
        },
      },
    });

    const runtime = new AgentRuntime({
      bus,
      runLoopEventService: createInMemoryRunLoopEventService(),
      consumerGroup: "group_b",
      consumerName: "consumer_b",
      logger: { info: () => {}, error: () => {} },
    });

    await runtime.processOnce();

    expect(bus.published).toHaveLength(1);
    expect(typeof bus.published[0]?.id).toBe("string");
    expect(bus.published[0]?.id.length).toBeGreaterThan(0);
    expect(typeof bus.published[0]?.timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(bus.published[0]?.timestamp ?? ""))).toBe(false);
    expect(bus.published[0]?.type).toBe(EVENT_TYPE.AGENT_RUN_FAILED);
    expect(bus.published[0]?.correlationId).toBe("corr_2");
    expect(bus.published[0]?.payload).toEqual({
      requestEventId: "evt_req_2",
      error: "Agent runtime failed to process the request.",
    });
    expect(bus.acknowledged).toEqual([{ groupName: "group_b", streamEntryId: "2-0" }]);
  });
});
