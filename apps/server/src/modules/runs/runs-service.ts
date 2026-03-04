import type { LibSQLDatabase } from "drizzle-orm/libsql";

import type { Schema } from "../../../db/schema";
import { DrizzleRunRepository, type RunRepository } from "./runs-repository";
import type { CreateRunInput, RunService, UpdateRunStatusInput } from "./runs-schemas";

export class DrizzleRunService implements RunService {
  public constructor(private readonly runRepository: RunRepository) {}

  public static fromDatabase(database: LibSQLDatabase<Schema>) {
    return new DrizzleRunService(new DrizzleRunRepository(database));
  }

  public async createQueuedRun(input: CreateRunInput) {
    await this.runRepository.insertRun({
      runId: input.runId,
      threadId: input.threadId,
      status: "queued",
    });
  }

  public async updateRunStatus(input: UpdateRunStatusInput) {
    await this.runRepository.updateRunStatus(input);
  }
}
