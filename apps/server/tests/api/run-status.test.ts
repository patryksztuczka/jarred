import { describe, expect, test } from "bun:test";
import { createApp } from "../../src/app";
import type { ChatMessageService } from "../../src/services/chat/message-service";
import type { ChatRunService } from "../../src/services/chat/run-service";
import type { RunLoopEventService } from "../../src/services/chat/loop-event-service";
import type { EventPublisher } from "../../src/events/types";

const createPublisherSpy = () => {
  const publisher: EventPublisher = {
    publish: async () => {
      return;
    },
  };

  return { publisher };
};

const createMessageService = (): ChatMessageService => {
  return {
    createIncomingMessage: async (input) => {
      return {
        messageId: `msg_${input.correlationId}`,
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
      return [];
    },
  };
};

const readJsonIfPresent = async (res: Response) => {
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return;
  }

  return (await res.json()) as unknown;
};

describe("GET /api/chat/runs/:runId", () => {
  test("returns run state for existing run id", async () => {
    const { publisher } = createPublisherSpy();
    const messageService = createMessageService();
    const runService: ChatRunService = {
      createQueuedRun: async () => {
        throw new Error("createQueuedRun should not be called");
      },
      updateRunStatus: async () => {
        throw new Error("updateRunStatus should not be called");
      },
      getRunById: async (runId) => {
        if (runId !== "run_abcdefghijklmnopqrstuvwx") {
          return;
        }

        return {
          id: runId,
          threadId: "thr_abcdefghijklmnopqrstuvwx",
          correlationId: "corr_1",
          status: "completed",
          safeError: undefined,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:01.000Z",
        };
      },
    };

    const app = createApp({ publisher, messageService, runService });

    const res = await app.request("/api/chat/runs/run_abcdefghijklmnopqrstuvwx");
    const body = (await readJsonIfPresent(res)) as
      | {
          ok: boolean;
          run: {
            id: string;
            threadId: string;
            correlationId: string;
            status: string;
            safeError?: string;
            createdAt: string;
            updatedAt: string;
          };
        }
      | undefined;

    expect(res.status).toBe(200);
    expect(body?.ok).toBe(true);
    expect(body?.run).toEqual({
      id: "run_abcdefghijklmnopqrstuvwx",
      threadId: "thr_abcdefghijklmnopqrstuvwx",
      correlationId: "corr_1",
      status: "completed",
      safeError: undefined,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z",
    });
  });

  test("returns 404 when run does not exist", async () => {
    const { publisher } = createPublisherSpy();
    const messageService = createMessageService();
    const runService: ChatRunService = {
      createQueuedRun: async () => {
        throw new Error("createQueuedRun should not be called");
      },
      updateRunStatus: async () => {
        throw new Error("updateRunStatus should not be called");
      },
      getRunById: async () => {
        return undefined;
      },
    };

    const app = createApp({ publisher, messageService, runService });

    const res = await app.request("/api/chat/runs/run_abcdefghijklmnopqrstuvwx");
    const body = (await readJsonIfPresent(res)) as { ok: boolean; error: string } | undefined;

    expect(res.status).toBe(404);
    expect(body?.ok).toBe(false);
    expect(body?.error).toBe("Run not found");
  });

  test("returns 400 for invalid run id format", async () => {
    const { publisher } = createPublisherSpy();
    const messageService = createMessageService();
    const runService: ChatRunService = {
      createQueuedRun: async () => {
        throw new Error("createQueuedRun should not be called");
      },
      updateRunStatus: async () => {
        throw new Error("updateRunStatus should not be called");
      },
      getRunById: async () => {
        return undefined;
      },
    };

    const app = createApp({ publisher, messageService, runService });

    const res = await app.request("/api/chat/runs/not-a-run-id");
    const body = (await readJsonIfPresent(res)) as { ok: boolean; error: string } | undefined;

    expect(res.status).toBe(400);
    expect(body?.ok).toBe(false);
    expect(body?.error).toBe("Invalid runId. Expected format: run_<24 lowercase alphanumerics>");
  });
});

describe("GET /api/chat/runs/:runId/events", () => {
  test("returns loop events for existing run id", async () => {
    const { publisher } = createPublisherSpy();
    const messageService = createMessageService();
    const runService: ChatRunService = {
      createQueuedRun: async () => {
        throw new Error("createQueuedRun should not be called");
      },
      updateRunStatus: async () => {
        throw new Error("updateRunStatus should not be called");
      },
      getRunById: async () => {
        return {
          id: "run_abcdefghijklmnopqrstuvwx",
          threadId: "thr_abcdefghijklmnopqrstuvwx",
          correlationId: "corr_1",
          status: "processing",
          safeError: undefined,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        };
      },
    };
    const runLoopEventService: RunLoopEventService = {
      appendEvent: async () => {
        throw new Error("appendEvent should not be called");
      },
      listByRunId: async () => {
        return [
          {
            id: "evt_1",
            runId: "run_abcdefghijklmnopqrstuvwx",
            eventType: "loop.completed",
            payload: {
              output: "Response text",
            },
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ];
      },
    };

    const app = createApp({ publisher, messageService, runService, runLoopEventService });

    const res = await app.request("/api/chat/runs/run_abcdefghijklmnopqrstuvwx/events");
    const body = (await readJsonIfPresent(res)) as
      | {
          ok: boolean;
          events: Array<{ id: string; eventType: string }>;
        }
      | undefined;

    expect(res.status).toBe(200);
    expect(body?.ok).toBe(true);
    expect(body?.events).toHaveLength(1);
    expect(body?.events[0]).toEqual(
      expect.objectContaining({
        id: "evt_1",
        eventType: "loop.completed",
      }),
    );
  });

  test("returns 400 for invalid run id format", async () => {
    const { publisher } = createPublisherSpy();
    const messageService = createMessageService();
    const runService: ChatRunService = {
      createQueuedRun: async () => {
        throw new Error("createQueuedRun should not be called");
      },
      updateRunStatus: async () => {
        throw new Error("updateRunStatus should not be called");
      },
      getRunById: async () => {
        return undefined;
      },
    };
    const runLoopEventService: RunLoopEventService = {
      appendEvent: async () => {
        throw new Error("appendEvent should not be called");
      },
      listByRunId: async () => {
        return [];
      },
    };

    const app = createApp({ publisher, messageService, runService, runLoopEventService });

    const res = await app.request("/api/chat/runs/not-a-run-id/events");
    const body = (await readJsonIfPresent(res)) as { ok: boolean; error: string } | undefined;

    expect(res.status).toBe(400);
    expect(body?.ok).toBe(false);
    expect(body?.error).toBe("Invalid runId. Expected format: run_<24 lowercase alphanumerics>");
  });
});
