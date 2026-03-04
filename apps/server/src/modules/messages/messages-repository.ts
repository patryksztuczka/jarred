import { asc, desc, eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

import { messages, threads, type Schema } from "../../../db/schema";

interface StoredMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
}

export interface MessageRepository {
  ensureThread(threadId: string): Promise<void>;
  insertMessage(input: {
    messageId: string;
    threadId: string;
    role: StoredMessage["role"];
    content: string;
  }): Promise<void>;
  listMessagesByThreadId(threadId: string, limit?: number): Promise<StoredMessage[]>;
}

export class DrizzleMessageRepository implements MessageRepository {
  constructor(private readonly database: LibSQLDatabase<Schema>) {}

  async ensureThread(threadId: string) {
    await this.database
      .insert(threads)
      .values({
        id: threadId,
      })
      .onConflictDoNothing({
        target: threads.id,
      });
  }

  async insertMessage(input: {
    messageId: string;
    threadId: string;
    role: StoredMessage["role"];
    content: string;
  }) {
    await this.database.insert(messages).values({
      id: input.messageId,
      threadId: input.threadId,
      role: input.role,
      content: input.content,
    });
  }

  async listMessagesByThreadId(threadId: string, limit?: number) {
    let query = this.database
      .select({
        role: messages.role,
        content: messages.content,
      })
      .from(messages)
      .where(eq(messages.threadId, threadId));

    query = limit
      ? (query.orderBy(desc(messages.createdAt)).limit(limit) as typeof query)
      : (query.orderBy(asc(messages.createdAt)) as typeof query);

    const rows = await query;
    const orderedRows = limit ? rows.toReversed() : rows;

    return orderedRows;
  }
}
