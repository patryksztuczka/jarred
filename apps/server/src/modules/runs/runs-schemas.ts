export type RunStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";

export interface CreateRunInput {
  runId: string;
  threadId: string;
}

export interface UpdateRunStatusInput {
  runId: string;
  status: RunStatus;
  error?: string;
}

export interface RunService {
  createQueuedRun(input: CreateRunInput): Promise<void>;
  updateRunStatus(input: UpdateRunStatusInput): Promise<void>;
}
