import type { ModelMessage } from "ai";
import { z } from "zod";

export const EVENT_TYPE = {
  AGENT_RUN_REQUESTED: "agent.run.requested",
  AGENT_RUN_COMPLETED: "agent.run.completed",
  AGENT_RUN_FAILED: "agent.run.failed",
} as const;

export type AgentEventType = (typeof EVENT_TYPE)[keyof typeof EVENT_TYPE];

export interface AgentRunRequestedPayload {
  runId: string;
  threadId: string;
  message: ModelMessage;
  model: string;
}

export interface AgentRunCompletedPayload {
  requestEventId: string;
}

export interface AgentRunFailedPayload {
  requestEventId: string;
  error: string;
}

export interface AgentEventPayloadByType {
  [EVENT_TYPE.AGENT_RUN_REQUESTED]: AgentRunRequestedPayload;
  [EVENT_TYPE.AGENT_RUN_COMPLETED]: AgentRunCompletedPayload;
  [EVENT_TYPE.AGENT_RUN_FAILED]: AgentRunFailedPayload;
}

export interface AgentEvent<TType extends AgentEventType = AgentEventType> {
  id: string;
  type: TType;
  timestamp: string;
  payload: AgentEventPayloadByType[TType];
}

export interface EventPublisher {
  publish(event: AgentEvent): Promise<void>;
}

export const createChatMessageRequestSchema = z.object({
  threadId: z
    .string()
    .trim()
    .regex(/^thr_[a-z0-9]{24}$/)
    .optional(),
  content: z.string().trim().min(1),
  model: z.string().trim().min(1).max(100).optional(),
});

export type CreateChatMessageRequest = z.infer<typeof createChatMessageRequestSchema>;

export const parseCreateChatMessageRequest = (value: unknown) => {
  const parsed = createChatMessageRequestSchema.safeParse(value);
  if (!parsed.success) {
    return;
  }

  return parsed.data;
};
