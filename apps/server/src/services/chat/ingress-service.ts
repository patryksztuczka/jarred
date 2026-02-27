import type { ModelMessage } from "ai";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

import { messages, outboxEvents, runs, threads, type Schema } from "../../../db/schema";
import { EVENT_TYPE, type AgentEvent } from "../../events/types";
import type { OutboxPubSub } from "../events/outbox-pubsub";

interface CreateIncomingMessageAndQueueRunInput {
  threadId: string;
  runId: string;
  model: string;
  message: ModelMessage;
}

interface PersistedIngressRecord {
  messageId: string;
  threadId: string;
  runId: string;
  model: string;
}

export interface ChatIngressService {
  createIncomingMessageAndQueueRun(
    input: CreateIncomingMessageAndQueueRunInput,
  ): Promise<PersistedIngressRecord>;
}

export const createDrizzleChatIngressService = (
  database: LibSQLDatabase<Schema>,
  pubsub: OutboxPubSub,
) => {
  const createIncomingMessageAndQueueRun = async (input: CreateIncomingMessageAndQueueRunInput) => {
    const messageId = crypto.randomUUID();
    const event: AgentEvent<typeof EVENT_TYPE.AGENT_RUN_REQUESTED> = {
      id: crypto.randomUUID(),
      type: EVENT_TYPE.AGENT_RUN_REQUESTED,
      timestamp: new Date().toISOString(),
      payload: {
        runId: input.runId,
        threadId: input.threadId,
        message: input.message,
        model: input.model,
      },
    };

    await database.transaction(async (transaction) => {
      await transaction
        .insert(threads)
        .values({
          id: input.threadId,
        })
        .onConflictDoNothing({
          target: threads.id,
        });

      await transaction.insert(messages).values({
        id: messageId,
        threadId: input.threadId,
        role: input.message.role,
        content: input.message.content,
      });

      await transaction.insert(runs).values({
        id: input.runId,
        threadId: input.threadId,
        status: "queued",
      });

      await transaction.insert(outboxEvents).values({
        id: event.id,
        eventType: event.type,
        payload: JSON.stringify(event),
        status: "pending",
        attempts: 0,
        lastError: undefined,
        publishedAt: undefined,
      });
    });

    pubsub.publish({ type: "outbox.event_created" });

    return {
      messageId,
      threadId: input.threadId,
      runId: input.runId,
      model: input.model,
    } satisfies PersistedIngressRecord;
  };

  return {
    createIncomingMessageAndQueueRun,
  } satisfies ChatIngressService;
};
