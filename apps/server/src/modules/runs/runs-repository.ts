import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

import { runs, type Schema } from "../../../db/schema";
import type { RunStatus } from "./runs-schemas";

export interface RunRepository {
  insertRun(input: { runId: string; threadId: string; status: RunStatus }): Promise<void>;
  updateRunStatus(input: { runId: string; status: RunStatus; error?: string }): Promise<void>;
}

export class DrizzleRunRepository implements RunRepository {
  public constructor(private readonly database: LibSQLDatabase<Schema>) {}

  public async insertRun(input: { runId: string; threadId: string; status: RunStatus }) {
    await this.database.insert(runs).values({
      id: input.runId,
      threadId: input.threadId,
      status: input.status,
    });
  }

  public async updateRunStatus(input: { runId: string; status: RunStatus; error?: string }) {
    await this.database
      .update(runs)
      .set({
        status: input.status,
        error: input.error ?? null,
        updatedAt: new Date(),
      })
      .where(eq(runs.id, input.runId));
  }
}
