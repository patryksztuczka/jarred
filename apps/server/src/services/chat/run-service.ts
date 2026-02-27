import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { runs, threads, type Schema } from "../../../db/schema";

import type { ChatRunPubSub } from "./run-pubsub";

export type RunStatus = "queued" | "processing" | "completed" | "failed";

export interface ChatRun {
  id: string;
  threadId: string;
  status: RunStatus;
  safeError?: string;
  createdAt: string;
  updatedAt: string;
}

interface CreateQueuedRunInput {
  id: string;
  threadId: string;
}

interface UpdateRunStatusInput {
  runId: string;
  status: RunStatus;
  safeError?: string;
}

export interface RunService {
  createQueuedRun(input: CreateQueuedRunInput): Promise<ChatRun>;
  updateRunStatus(input: UpdateRunStatusInput): Promise<ChatRun | undefined>;
  getRunById(runId: string): Promise<ChatRun | undefined>;
}

export const createDrizzleChatRunService = (
  database: LibSQLDatabase<Schema>,
  pubsub?: ChatRunPubSub,
) => {
  const createQueuedRun = async (input: CreateQueuedRunInput) => {
    await database
      .insert(threads)
      .values({
        id: input.threadId,
      })
      .onConflictDoNothing({
        target: threads.id,
      });

    await database.insert(runs).values({
      id: input.id,
      threadId: input.threadId,
      status: "queued",
      error: undefined,
    });

    const run = await getRunById(input.id);
    if (!run) {
      throw new Error("Failed to create queued run");
    }

    pubsub?.publish(run.id, { type: "run.status", data: run });
    return run;
  };

  const updateRunStatus = async (input: UpdateRunStatusInput) => {
    const safeError = input.status === "failed" ? input.safeError : undefined;

    await database
      .update(runs)
      .set({
        status: input.status,
        error: safeError,
        updatedAt: new Date(),
      })
      .where(eq(runs.id, input.runId));

    const run = await getRunById(input.runId);
    if (run) {
      pubsub?.publish(run.id, { type: "run.status", data: run });
    }
    return run;
  };

  const getRunById = async (runId: string) => {
    const result = await database
      .select({
        id: runs.id,
        threadId: runs.threadId,
        status: runs.status,
        safeError: runs.error,
        createdAt: runs.createdAt,
        updatedAt: runs.updatedAt,
      })
      .from(runs)
      .where(eq(runs.id, runId))
      .limit(1);

    const first = result[0];
    if (!first) {
      return;
    }

    return {
      id: first.id,
      threadId: first.threadId,
      status: first.status,
      safeError: first.safeError ?? undefined,
      createdAt: first.createdAt.toISOString(),
      updatedAt: first.updatedAt.toISOString(),
    } satisfies ChatRun;
  };

  return {
    createQueuedRun,
    updateRunStatus,
    getRunById,
  } satisfies RunService;
};
