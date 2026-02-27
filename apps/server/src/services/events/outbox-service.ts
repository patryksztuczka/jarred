import { asc, eq, inArray } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { outboxEvents, type Schema } from "../../../db/schema";
import type { AgentEvent } from "../../events/types";
import type { OutboxPubSub } from "./outbox-pubsub";

export type OutboxStatus = "pending" | "published" | "failed";

export interface OutboxEventRecord {
  id: string;
  event: AgentEvent;
  status: OutboxStatus;
  attempts: number;
  lastError?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface CreateOutboxEventInput {
  event: AgentEvent;
}

export interface OutboxService {
  createPendingEvent(input: CreateOutboxEventInput): Promise<void>;
  listRetryableEvents(limit: number): Promise<OutboxEventRecord[]>;
  markPublished(id: string): Promise<void>;
  markPublishFailed(id: string, error: string): Promise<void>;
}

const RETRYABLE_STATUSES: OutboxStatus[] = ["pending", "failed"];

export const createDrizzleOutboxService = (
  database: LibSQLDatabase<Schema>,
  pubsub?: OutboxPubSub,
) => {
  const createPendingEvent = async (input: CreateOutboxEventInput) => {
    await database.insert(outboxEvents).values({
      id: input.event.id,
      eventType: input.event.type,
      payload: JSON.stringify(input.event),
      status: "pending",
      attempts: 0,
      lastError: undefined,
      publishedAt: undefined,
    });

    pubsub?.publish({ type: "outbox.event_created" });
  };

  const listRetryableEvents = async (limit: number) => {
    const results = await database
      .select({
        id: outboxEvents.id,
        payload: outboxEvents.payload,
        status: outboxEvents.status,
        attempts: outboxEvents.attempts,
        lastError: outboxEvents.lastError,
        publishedAt: outboxEvents.publishedAt,
        createdAt: outboxEvents.createdAt,
        updatedAt: outboxEvents.updatedAt,
      })
      .from(outboxEvents)
      .where(inArray(outboxEvents.status, RETRYABLE_STATUSES))
      .orderBy(asc(outboxEvents.createdAt))
      .limit(limit);

    return results.flatMap((row) => {
      try {
        const parsedEvent = JSON.parse(row.payload) as AgentEvent;

        return {
          id: row.id,
          event: parsedEvent,
          status: row.status,
          attempts: row.attempts,
          lastError: row.lastError ?? undefined,
          publishedAt: row.publishedAt ? row.publishedAt.toISOString() : undefined,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        } satisfies OutboxEventRecord;
      } catch {
        return [];
      }
    });
  };

  const markPublished = async (id: string) => {
    await database
      .update(outboxEvents)
      .set({
        status: "published",
        publishedAt: new Date(),
        updatedAt: new Date(),
        lastError: undefined,
      })
      .where(eq(outboxEvents.id, id));
  };

  const markPublishFailed = async (id: string, error: string) => {
    const existing = await database
      .select({
        attempts: outboxEvents.attempts,
      })
      .from(outboxEvents)
      .where(eq(outboxEvents.id, id))
      .limit(1);

    const first = existing[0];
    if (!first) {
      return;
    }

    await database
      .update(outboxEvents)
      .set({
        status: "failed",
        attempts: first.attempts + 1,
        lastError: error,
        updatedAt: new Date(),
      })
      .where(eq(outboxEvents.id, id));
  };

  return {
    createPendingEvent,
    listRetryableEvents,
    markPublished,
    markPublishFailed,
  } satisfies OutboxService;
};

export const createInMemoryOutboxService = (pubsub?: OutboxPubSub) => {
  const records = new Map<string, OutboxEventRecord>();

  const createPendingEvent = async (input: CreateOutboxEventInput) => {
    const now = new Date().toISOString();
    records.set(input.event.id, {
      id: input.event.id,
      event: input.event,
      status: "pending",
      attempts: 0,
      lastError: undefined,
      publishedAt: undefined,
      createdAt: now,
      updatedAt: now,
    });

    pubsub?.publish({ type: "outbox.event_created" });
  };

  const listRetryableEvents = async (limit: number) => {
    return [...records.values()]
      .filter((record) => {
        return record.status === "pending" || record.status === "failed";
      })
      .toSorted((left, right) => {
        return left.createdAt.localeCompare(right.createdAt);
      })
      .slice(0, limit);
  };

  const markPublished = async (id: string) => {
    const existing = records.get(id);
    if (!existing) {
      return;
    }

    const now = new Date().toISOString();
    records.set(id, {
      ...existing,
      status: "published",
      lastError: undefined,
      publishedAt: now,
      updatedAt: now,
    });
  };

  const markPublishFailed = async (id: string, error: string) => {
    const existing = records.get(id);
    if (!existing) {
      return;
    }

    records.set(id, {
      ...existing,
      status: "failed",
      attempts: existing.attempts + 1,
      lastError: error,
      updatedAt: new Date().toISOString(),
    });
  };

  const getById = (id: string) => {
    return records.get(id);
  };

  return {
    createPendingEvent,
    listRetryableEvents,
    markPublished,
    markPublishFailed,
    getById,
  };
};
