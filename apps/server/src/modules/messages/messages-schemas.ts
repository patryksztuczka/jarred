import type { ModelMessage } from "ai";
import { z } from "zod";

export const createChatMessageRequestSchema = z.object({
  content: z.string().min(1),
  model: z.string().min(1).optional(),
  threadId: z
    .string()
    .regex(/^thr_[a-z0-9]{24}$/)
    .optional(),
});

export interface CreateIncomingMessageInput {
  threadId: string;
  content: string;
}

export interface CreateAgentMessageInput {
  threadId: string;
  content: string;
}

export interface CreateMessageInput {
  threadId: string;
  role: "assistant" | "tool";
  content: string;
}

export interface PersistedMessage {
  messageId: string;
  threadId: string;
}

export interface MessageService {
  createIncomingMessage(input: CreateIncomingMessageInput): Promise<PersistedMessage>;
  createAgentMessage(input: CreateAgentMessageInput): Promise<PersistedMessage>;
  createMessage(input: CreateMessageInput): Promise<PersistedMessage>;
  listMessagesByThreadId(threadId: string, limit?: number): Promise<ModelMessage[]>;
}
