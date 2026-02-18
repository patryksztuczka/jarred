import { describe, expect, test } from "bun:test";
import { createApp } from "../../src/app";
import {
  createInMemoryChatMessageService,
  type ChatHistoryMessage,
} from "../../src/services/chat/message-service";
import { createInMemoryRunLoopEventService } from "../../src/services/chat/loop-event-service";
import { createInMemoryChatRunService } from "../../src/services/chat/run-service";
import { AgentRuntime, type RuntimeEventBus } from "../../src/runtime/agent-runtime";
import type { AgentEvent } from "../../src/events/types";

class InMemoryRuntimeBus implements RuntimeEventBus {
  public readonly queuedEntries: Array<{ streamEntryId: string; event: AgentEvent }> = [];

  public async publish(event: AgentEvent) {
    this.queuedEntries.push({
      streamEntryId: `${this.queuedEntries.length + 1}-0`,
      event,
    });
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
    void groupName;
    void streamEntryId;
  }
}

const readJsonIfPresent = async (res: Response) => {
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return;
  }

  return (await res.json()) as unknown;
};

describe("chat ingress + runtime + history", () => {
  test("returns both user and assistant messages after runtime processing", async () => {
    const bus = new InMemoryRuntimeBus();
    const messageService = createInMemoryChatMessageService();
    const runService = createInMemoryChatRunService();
    const app = createApp({
      publisher: bus,
      messageService,
      runService,
    });
    const runtime = new AgentRuntime({
      bus,
      messageService,
      runService,
      runLoopEventService: createInMemoryRunLoopEventService(),
      consumerGroup: "group_history_e2e",
      consumerName: "consumer_history_e2e",
      logger: { info: () => {}, error: () => {} },
    });

    const ingressRes = await app.request("/api/chat/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content: "Summarize yesterday's deployment.",
      }),
    });

    const ingressBody = (await readJsonIfPresent(ingressRes)) as
      | {
          ok: boolean;
          runId: string;
          threadId: string;
          correlationId: string;
        }
      | undefined;

    expect(ingressRes.status).toBe(202);
    expect(ingressBody?.ok).toBe(true);
    expect(typeof ingressBody?.runId).toBe("string");
    expect(typeof ingressBody?.threadId).toBe("string");
    expect(typeof ingressBody?.correlationId).toBe("string");

    await runtime.processOnce();

    const historyRes = await app.request(
      `/api/chat/threads/${ingressBody?.threadId ?? ""}/messages`,
    );
    const historyBody = (await readJsonIfPresent(historyRes)) as
      | {
          ok: boolean;
          messages: ChatHistoryMessage[];
        }
      | undefined;

    expect(historyRes.status).toBe(200);
    expect(historyBody?.ok).toBe(true);
    expect(historyBody?.messages).toHaveLength(2);
    expect(historyBody?.messages[0]?.role).toBe("user");
    expect(historyBody?.messages[1]?.role).toBe("assistant");
    expect(historyBody?.messages[1]?.threadId).toBe(ingressBody?.threadId);
    expect(historyBody?.messages[1]?.correlationId).toBe(ingressBody?.correlationId);

    const runRes = await app.request(`/api/chat/runs/${ingressBody?.runId ?? ""}`);
    const runBody = (await readJsonIfPresent(runRes)) as
      | {
          ok: boolean;
          run: {
            threadId: string;
            correlationId: string;
            status: string;
          };
        }
      | undefined;

    expect(runRes.status).toBe(200);
    expect(runBody?.ok).toBe(true);
    expect(runBody?.run.threadId).toBe(ingressBody?.threadId);
    expect(runBody?.run.correlationId).toBe(ingressBody?.correlationId);
    expect(runBody?.run.status).toBe("completed");
  });
});
