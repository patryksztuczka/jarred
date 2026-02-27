import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { createId } from "@paralleldrive/cuid2";
import type { MessageService } from "./services/chat/message-service";
import type { RunService } from "./services/chat/run-service";
import type { ChatIngressService } from "./services/chat/ingress-service";
import type { RunLoopEventService } from "./services/chat/loop-event-service";
import type { ChatRunPubSub } from "./services/chat/run-pubsub";
import { parseCreateChatMessageRequest, type EventPublisher } from "./events/types";
import { DEFAULT_MODEL } from "./lib/constants";

interface CreateAppOptions {
  publisher: EventPublisher;
  ingressService: ChatIngressService;
  messageService: MessageService;
  runService: RunService;
  runLoopEventService: RunLoopEventService;
  pubsub: ChatRunPubSub;
}

export const createApp = (options: CreateAppOptions) => {
  const app = new Hono();
  const pubsub = options.pubsub;
  const messageService = options.messageService;
  const runService = options.runService;
  const ingressService = options.ingressService;
  const runLoopEventService = options.runLoopEventService;

  const threadIdPattern = /^thr_[a-z0-9]{24}$/;
  const runIdPattern = /^run_[a-z0-9]{24}$/;

  app.get("/api", (c) => {
    return c.json({ ok: true, message: "API is running" });
  });

  app.post("/api/chat/messages", async (c) => {
    const body: unknown = await c.req.json().catch(() => {
      return;
    });

    const request = parseCreateChatMessageRequest(body);

    if (!request) {
      return c.json(
        {
          ok: false,
          error:
            "Invalid request body. Expected { content: string, model?: string, threadId?: 'thr_<24 lowercase alphanumerics>' }",
        },
        400,
      );
    }

    const threadId = request.threadId ?? `thr_${createId()}`;
    const runId = `run_${createId()}`;
    const model = request.model;

    const persistedMessage = await ingressService.createIncomingMessageAndQueueRun({
      threadId,
      runId,
      message: {
        role: "user",
        content: request.content,
      },
      model: model ?? DEFAULT_MODEL,
    });

    return c.json(
      {
        ok: true,
        status: "accepted",
        runId,
        threadId: persistedMessage.threadId,
        messageId: persistedMessage.messageId,
        model: model ?? DEFAULT_MODEL,
      },
      202,
    );
  });

  app.get("/api/chat/threads/:threadId/messages", async (c) => {
    const threadId = c.req.param("threadId");
    if (!threadIdPattern.test(threadId)) {
      return c.json(
        {
          ok: false,
          error: "Invalid threadId. Expected format: thr_<24 lowercase alphanumerics>",
        },
        400,
      );
    }

    const messages = await messageService.listMessagesByThreadId(threadId);

    return c.json({
      ok: true,
      messages,
    });
  });

  app.get("/api/chat/runs/:runId", async (c) => {
    const runId = c.req.param("runId");
    if (!runIdPattern.test(runId)) {
      return c.json(
        {
          ok: false,
          error: "Invalid runId. Expected format: run_<24 lowercase alphanumerics>",
        },
        400,
      );
    }

    const run = await runService.getRunById(runId);
    if (!run) {
      return c.json(
        {
          ok: false,
          error: "Run not found",
        },
        404,
      );
    }

    return c.json({
      ok: true,
      run,
    });
  });

  app.get("/api/chat/runs/:runId/events", async (c) => {
    const runId = c.req.param("runId");
    if (!runIdPattern.test(runId)) {
      return c.json(
        {
          ok: false,
          error: "Invalid runId. Expected format: run_<24 lowercase alphanumerics>",
        },
        400,
      );
    }

    const events = runLoopEventService ? await runLoopEventService.listByRunId(runId) : [];

    return c.json({
      ok: true,
      events,
    });
  });

  app.get("/api/chat/runs/:runId/stream", async (c) => {
    const runId = c.req.param("runId");
    if (!runIdPattern.test(runId)) {
      return c.json(
        {
          ok: false,
          error: "Invalid runId. Expected format: run_<24 lowercase alphanumerics>",
        },
        400,
      );
    }

    if (!pubsub) {
      return c.json(
        {
          ok: false,
          error: "Streaming is not configured on this server.",
        },
        500,
      );
    }

    return streamSSE(c, async (stream) => {
      const seenEventIds = new Set<string>();

      // Send existing events
      const existingEvents = runLoopEventService
        ? await runLoopEventService.listByRunId(runId)
        : [];
      for (const event of existingEvents) {
        seenEventIds.add(event.id);
        await stream.writeSSE({
          event: "run.event",
          data: JSON.stringify(event),
          id: event.id,
        });
      }

      // Check existing status
      const existingRun = await runService.getRunById(runId);
      if (existingRun && (existingRun.status === "completed" || existingRun.status === "failed")) {
        await stream.writeSSE({
          event: "run.status",
          data: JSON.stringify(existingRun),
        });

        if (existingRun.status === "completed") {
          const messages = await messageService.listMessagesByThreadId(existingRun.threadId);
          const reply = messages.toReversed().find((message) => {
            return message.role === "assistant";
          });
          if (reply) {
            await stream.writeSSE({
              event: "run.reply",
              data: JSON.stringify({ content: reply.content }),
            });
          }
        }
        return;
      }

      // Subscribe to new events
      let unsubscribe: (() => void) | undefined;

      const finished = new Promise<void>((resolve) => {
        stream.onAbort(() => resolve());

        unsubscribe = pubsub.subscribe(runId, async (event) => {
          if (event.type === "run.event") {
            if (seenEventIds.has(event.data.id)) return;
            seenEventIds.add(event.data.id);
            await stream.writeSSE({
              event: "run.event",
              data: JSON.stringify(event.data),
              id: event.data.id,
            });
          } else if (event.type === "run.status") {
            await stream.writeSSE({
              event: "run.status",
              data: JSON.stringify(event.data),
            });

            if (event.data.status === "completed" || event.data.status === "failed") {
              if (event.data.status === "completed") {
                const messages = await messageService.listMessagesByThreadId(event.data.threadId);
                const reply = messages.toReversed().find((message) => {
                  return message.role === "assistant";
                });
                if (reply) {
                  await stream.writeSSE({
                    event: "run.reply",
                    data: JSON.stringify({ content: reply.content }),
                  });
                }
              }
              resolve();
            }
          }
        });
      });

      await finished;
      unsubscribe?.();
    });
  });

  return app;
};

const noopPublisher: EventPublisher = {
  publish: async () => {
    return;
  },
};

export const app = createApp({ publisher: noopPublisher });
