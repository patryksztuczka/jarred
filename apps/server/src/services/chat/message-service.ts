import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { asc, desc, eq } from "drizzle-orm";
import { messages, threads, type Schema } from "../../../db/schema";

interface CreateIncomingMessageInput {
  threadId: string;
  content: string;
  correlationId: string;
}

interface CreateAssistantMessageInput {
  threadId: string;
  content: string;
  correlationId: string;
}

interface PersistedMessage {
  messageId: string;
  threadId: string;
}

export interface ChatHistoryMessage {
  id: string;
  threadId: string;
  role: "user" | "assistant" | "system";
  content: string;
  correlationId: string;
  createdAt: string;
}

export interface ChatMessageService {
  createIncomingMessage(input: CreateIncomingMessageInput): Promise<PersistedMessage>;
  createAssistantMessage(input: CreateAssistantMessageInput): Promise<PersistedMessage>;
  listMessagesByThreadId(threadId: string, limit?: number): Promise<ChatHistoryMessage[]>;
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
      correlationId: input.correlationId,
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
      correlationId: input.correlationId,
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
        correlationId: messages.correlationId,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.threadId, threadId));

    query = limit
      ? (query.orderBy(desc(messages.createdAt)).limit(limit) as typeof query)
      : (query.orderBy(asc(messages.createdAt)) as typeof query);

    const results = await query;

    const mapped = results.map((result) => {
      return {
        id: result.id,
        threadId: result.threadId,
        role: result.role,
        content: result.content,
        correlationId: result.correlationId,
        createdAt: result.createdAt.toISOString(),
      };
    });

    return limit ? mapped.toReversed() : mapped;
  };

  return {
    createIncomingMessage,
    createAssistantMessage,
    listMessagesByThreadId,
  } satisfies ChatMessageService;
};

export const createInMemoryChatMessageService = () => {
  const records = new Map<string, ChatHistoryMessage>();

  const createIncomingMessage = async (input: CreateIncomingMessageInput) => {
    const messageId = crypto.randomUUID();
    const now = new Date().toISOString();
    const record: ChatHistoryMessage = {
      id: messageId,
      threadId: input.threadId,
      role: "user",
      content: input.content,
      correlationId: input.correlationId,
      createdAt: now,
    };

    records.set(messageId, record);
    return {
      messageId,
      threadId: input.threadId,
    };
  };

  const createAssistantMessage = async (input: CreateAssistantMessageInput) => {
    const messageId = crypto.randomUUID();
    const now = new Date().toISOString();
    const record: ChatHistoryMessage = {
      id: messageId,
      threadId: input.threadId,
      role: "assistant",
      content: input.content,
      correlationId: input.correlationId,
      createdAt: now,
    };

    records.set(messageId, record);
    return {
      messageId,
      threadId: input.threadId,
    };
  };

  const listMessagesByThreadId = async (threadId: string, limit?: number) => {
    const threadRecords = [...records.values()].filter((record) => {
      return record.threadId === threadId;
    });

    threadRecords.sort((a, b) => {
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    if (limit) {
      return threadRecords.slice(-limit);
    }

    return threadRecords;
  };

  const getById = (messageId: string) => {
    return records.get(messageId);
  };

  return {
    createIncomingMessage,
    createAssistantMessage,
    listMessagesByThreadId,
    getById,
  };
};
