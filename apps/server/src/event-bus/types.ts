import type { ModelMessage } from "ai";

export const EVENT_TYPE = {
  AGENT_RUN_REQUESTED: "run.requested",
  AGENT_RUN_COMPLETED: "run.completed",
  AGENT_RUN_FAILED: "run.failed",
  AGENT_RUN_CANCELLED: "run.cancelled",
} as const;

type EventType = (typeof EVENT_TYPE)[keyof typeof EVENT_TYPE];

interface RunEventPayloadByType {
  [EVENT_TYPE.AGENT_RUN_REQUESTED]: {
    runId: string;
    threadId: string;
    messageId: string;
    model: string;
    message: ModelMessage;
  };
  [EVENT_TYPE.AGENT_RUN_COMPLETED]: {
    requestEventId: string;
    runId: string;
    threadId: string;
  };
  [EVENT_TYPE.AGENT_RUN_FAILED]: {
    requestEventId: string;
    runId: string;
    threadId: string;
    error: string;
  };
  [EVENT_TYPE.AGENT_RUN_CANCELLED]: {
    runId: string;
    threadId: string;
  };
}

export type AgentRunRequestedPayload = RunEventPayloadByType[typeof EVENT_TYPE.AGENT_RUN_REQUESTED];

export type RunEvent<Type extends EventType = EventType> = Type extends EventType
  ? {
      id: string;
      type: Type;
      timestamp: string;
      payload: RunEventPayloadByType[Type];
    }
  : never;
