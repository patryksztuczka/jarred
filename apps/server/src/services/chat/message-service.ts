import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { asc, desc, eq } from "drizzle-orm";
import { messages, threads, type Schema } from "../../../db/schema";
import type { ModelMessage } from "ai";

interface CreateIncomingMessageInput {
  threadId: string;
  content: string;
}

interface CreateAssistantMessageInput {
  threadId: string;
  content: string;
}

interface PersistedMessage {
  messageId: string;
  threadId: string;
}

export interface MessageService {
  createIncomingMessage(input: CreateIncomingMessageInput): Promise<PersistedMessage>;
  createAssistantMessage(input: CreateAssistantMessageInput): Promise<PersistedMessage>;
  listMessagesByThreadId(threadId: string, limit?: number): Promise<ModelMessage[]>;
}

export const createDrizzleChatMessageService = (database: LibSQLDatabase<Schema>) => {
  const createIncomingMessage = async (input: CreateIncomingMessageInput) => {
    await database
      .insert(threads)
      .values({
        id: input.threadId,
      })
      .onConflictDoNothing({
        target: threads.id,
      });

    const messageId = crypto.randomUUID();

    await database.insert(messages).values({
      id: messageId,
      threadId: input.threadId,
      role: "user",
      content: input.content,
    });

    return {
      messageId,
      threadId: input.threadId,
    };
  };

  const createAssistantMessage = async (input: CreateAssistantMessageInput) => {
    await database
      .insert(threads)
      .values({
        id: input.threadId,
      })
      .onConflictDoNothing({
        target: threads.id,
      });

    const messageId = crypto.randomUUID();

    await database.insert(messages).values({
      id: messageId,
      threadId: input.threadId,
      role: "assistant",
      content: input.content,
    });

    return {
      messageId,
      threadId: input.threadId,
    };
  };

  const listMessagesByThreadId = async (threadId: string, limit?: number) => {
    let query = database
      .select({
        id: messages.id,
        threadId: messages.threadId,
        role: messages.role,
        content: messages.content,
      })
      .from(messages)
      .where(eq(messages.threadId, threadId));

    query = limit
      ? (query.orderBy(desc(messages.createdAt)).limit(limit) as typeof query)
      : (query.orderBy(asc(messages.createdAt)) as typeof query);

    const results = await query;

    return limit ? results.toReversed() : results;
  };

  return {
    createIncomingMessage,
    createAssistantMessage,
    listMessagesByThreadId,
  } satisfies MessageService;
};
