import { asc, eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { runLoopEvents, type Schema } from "../../../db/schema";
import type { ChatRunPubSub } from "./run-pubsub";

export type AgentLoopStopReason = "success" | "max_iterations_reached" | "error";

export type RunLoopEventType = "loop.started" | "loop.completed" | "loop.error";

interface AppendRunLoopEventInput {
  runId: string;
  eventType: RunLoopEventType;
  payload: unknown;
}

export interface RunLoopEventRecord {
  id: string;
  runId: string;
  eventType: RunLoopEventType;
  payload: unknown;
  createdAt: string;
}

export interface RunLoopEventService {
  appendEvent(input: AppendRunLoopEventInput): Promise<void>;
  listByRunId(runId: string): Promise<RunLoopEventRecord[]>;
}

const parsePayload = (value: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {
      invalidPayload: true,
    };
  }
};

export const createDrizzleRunLoopEventService = (
  database: LibSQLDatabase<Schema>,
  pubsub?: ChatRunPubSub,
) => {
  const appendEvent = async (input: AppendRunLoopEventInput) => {
    const record = {
      id: crypto.randomUUID(),
      runId: input.runId,
      eventType: input.eventType,
      payload: JSON.stringify(input.payload),
    };

    await database.insert(runLoopEvents).values(record);

    pubsub?.publish(input.runId, {
      type: "run.event",
      data: {
        id: record.id,
        runId: record.runId,
        eventType: record.eventType,
        payload: input.payload,
        createdAt: new Date().toISOString(),
      },
    });
  };

  const listByRunId = async (runId: string) => {
    const rows = await database
      .select({
        id: runLoopEvents.id,
        runId: runLoopEvents.runId,
        eventType: runLoopEvents.eventType,
        payload: runLoopEvents.payload,
        createdAt: runLoopEvents.createdAt,
      })
      .from(runLoopEvents)
      .where(eq(runLoopEvents.runId, runId))
      .orderBy(asc(runLoopEvents.createdAt));

    return rows.map((row) => {
      return {
        id: row.id,
        runId: row.runId,
        eventType: row.eventType,
        payload: parsePayload(row.payload),
        createdAt: row.createdAt.toISOString(),
      } satisfies RunLoopEventRecord;
    });
  };

  return {
    appendEvent,
    listByRunId,
  } satisfies RunLoopEventService;
};
