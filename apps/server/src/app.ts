import { Hono } from "hono";
export { websocket } from "hono/bun";
import { createId } from "@paralleldrive/cuid2";
import { upgradeWebSocket } from "hono/bun";
import { AgentSession } from "@jarred/agent-session";
import { readWorkingMemory, updateWorkingMemory, webfetch } from "@jarred/agent-core";

import { createChatMessageRequestSchema } from "./modules/messages/messages-schemas";
import { DrizzleMessageService } from "./modules/messages/messages-service";
import { DrizzleRunService } from "./modules/runs/runs-service";
import { InMemoryEventBus } from "./agent/event-bus";
import { LangfuseService } from "./modules/llm/langfuse-service";
import { db } from "../db";

export const createApp = () => {
  const app = new Hono();
  const messageService = DrizzleMessageService.fromDatabase(db);
  const runService = DrizzleRunService.fromDatabase(db);
  const eventBus = new InMemoryEventBus();
  const langfuseService = new LangfuseService();

  const threadIdPattern = /^thr_[a-z0-9]{24}$/;

  app.get("/api", (c) => {
    return c.json({ ok: true, message: "API is running" });
  });

  app.post("/api/chat/messages", async (c) => {
    const body: unknown = await c.req.json().catch(() => {
      return;
    });

    const parsedRequest = createChatMessageRequestSchema.safeParse(body);

    if (!parsedRequest.success) {
      return c.json(
        {
          ok: false,
          error:
            "Invalid request body. Expected { content: string, model?: string, threadId?: 'thr_<24 lowercase alphanumerics>' }",
        },
        400,
      );
    }

    const request = parsedRequest.data;

    const threadId = request.threadId ?? `thr_${createId()}`;
    const runId = `run_${createId()}`;
    const previousMessages = await messageService.listMessagesByThreadId(threadId);

    const persistedMessage = await messageService.createIncomingMessage({
      threadId,
      content: request.content,
    });

    await runService.createQueuedRun({
      runId,
      threadId: persistedMessage.threadId,
    });

    const session = new AgentSession({
      systemPrompt: langfuseService.getSystemPrompt(),
      initialMessages: previousMessages,
      initialModel: request.model,
      tools: {
        webfetch,
        readWorkingMemory,
        updateWorkingMemory,
      },
    });

    session.subscribe(async (event) => {
      switch (event.type) {
        case "session.start": {
          await runService.updateRunStatus({ runId: event.runId, status: "processing" });
          eventBus.publish({
            type: "run.started",
            payload: { runId: event.runId, threadId: event.sessionId, model: event.model },
          });
          break;
        }
        case "agent.token": {
          eventBus.publish({
            type: "agent.token",
            payload: {
              runId: event.runId,
              threadId: event.sessionId,
              iteration: event.iteration,
              delta: event.delta,
            },
          });
          break;
        }
        case "tool.start": {
          eventBus.publish({
            type: "tool.started",
            payload: {
              runId: event.runId,
              threadId: event.sessionId,
              iteration: event.iteration,
              toolName: event.toolName,
            },
          });
          break;
        }
        case "message.complete": {
          await messageService.createMessage({
            threadId: event.sessionId,
            role: event.message.role,
            content: getPersistedMessageContent(event.message),
          });

          if (event.message.role !== "assistant") {
            break;
          }

          eventBus.publish({
            type: "agent.message",
            payload: {
              runId: event.runId,
              threadId: event.sessionId,
              message: getAssistantMessageText(event.message.content),
            },
          });
          break;
        }
        case "session.complete": {
          await runService.updateRunStatus({ runId: event.runId, status: "completed" });
          eventBus.publish({
            type: "run.completed",
            payload: { runId: event.runId, threadId: event.sessionId },
          });
          break;
        }
        case "session.error": {
          await runService.updateRunStatus({
            runId: event.runId,
            status: "failed",
            error: event.error,
          });
          eventBus.publish({
            type: "run.failed",
            payload: { runId: event.runId, threadId: event.sessionId, error: event.error },
          });
          break;
        }
      }
    });

    void session.prompt(request.content, {
      runId,
      sessionId: persistedMessage.threadId,
      model: request.model,
    });

    return c.json(
      {
        ok: true,
        status: "accepted",
        runId,
        threadId: persistedMessage.threadId,
        messageId: persistedMessage.messageId,
        model: request.model,
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

  app.get(
    "/ws/runs/:runId",
    upgradeWebSocket((c) => {
      const runId = c.req.param("runId");
      let unsubscribe: (() => void) | undefined;

      return {
        onOpen(_, ws) {
          unsubscribe = eventBus.subscribe(runId, (event) => {
            ws.send(JSON.stringify(event));
          });

          ws.send(
            JSON.stringify({
              type: "connection.ready",
              payload: {
                runId,
              },
            }),
          );
        },
        onClose() {
          unsubscribe?.();
        },
        onError() {
          unsubscribe?.();
        },
      };
    }),
  );

  return app;
};

function getAssistantMessageText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "No content";
  }

  const textContent = content
    .flatMap((part: { type?: string; text?: string }) =>
      part.type === "text" ? [part.text ?? ""] : [],
    )
    .join("\n")
    .trim();

  return textContent.length > 0 ? textContent : "No content";
}

function getPersistedMessageContent(message: { role: string; content: unknown }): string {
  if (message.role === "assistant") {
    return getAssistantMessageText(message.content);
  }

  if (!Array.isArray(message.content)) {
    return "No content";
  }

  const toolCalls = message.content
    .flatMap((part: { type?: string; toolName?: string; output?: unknown }) => {
      if (part.type !== "tool-result") {
        return [];
      }

      const payload = getToolPayload(part.output);

      return [
        {
          toolName: part.toolName ?? "unknown",
          args: payload?.args ?? null,
          output: payload?.output ?? part.output,
        },
      ];
    })
    .filter((entry: { toolName: string }) => entry.toolName.length > 0);

  return JSON.stringify(toolCalls);
}

function getToolPayload(output: unknown): { args: unknown; output: unknown } | undefined {
  if (!output || typeof output !== "object") {
    return undefined;
  }

  const record = output as Record<string, unknown>;
  if (record.type !== "text" || typeof record.value !== "string") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(record.value) as Record<string, unknown>;
    if (typeof parsed !== "object" || parsed === null) {
      return undefined;
    }

    return { args: parsed.args, output: parsed.output };
  } catch {
    return undefined;
  }
}
