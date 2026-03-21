import type { ModelMessage, ToolModelMessage } from "ai";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

import type {
  CreateMessageInput,
  CreateAssistantMessageInput,
  CreateIncomingMessageInput,
  MessageService,
} from "./messages-schemas";
import { DrizzleMessageRepository, type MessageRepository } from "./messages-repository";
import type { Schema } from "../../../db/schema";

export class DrizzleMessageService implements MessageService {
  constructor(private readonly messageRepository: MessageRepository) {}

  static fromDatabase(database: LibSQLDatabase<Schema>) {
    return new DrizzleMessageService(new DrizzleMessageRepository(database));
  }

  async createIncomingMessage(input: CreateIncomingMessageInput) {
    await this.messageRepository.ensureThread(input.threadId);

    const messageId = crypto.randomUUID();

    await this.messageRepository.insertMessage({
      messageId,
      threadId: input.threadId,
      role: "user",
      content: input.content,
    });

    return {
      messageId,
      threadId: input.threadId,
    };
  }

  async createAssistantMessage(input: CreateAssistantMessageInput) {
    return this.createMessage({
      threadId: input.threadId,
      role: "assistant",
      content: input.content,
    });
  }

  async createMessage(input: CreateMessageInput) {
    await this.messageRepository.ensureThread(input.threadId);

    const messageId = crypto.randomUUID();

    await this.messageRepository.insertMessage({
      messageId,
      threadId: input.threadId,
      role: input.role,
      content: input.content,
    });

    return {
      messageId,
      threadId: input.threadId,
    };
  }

  async listMessagesByThreadId(threadId: string, limit?: number) {
    const orderedResults = await this.messageRepository.listMessagesByThreadId(threadId, limit);

    return orderedResults.flatMap((message): ModelMessage[] => {
      if (message.role === "user") {
        return [{ role: "user", content: message.content }];
      }

      if (message.role === "assistant") {
        return [{ role: "assistant", content: message.content }];
      }

      if (message.role === "system") {
        return [{ role: "system", content: message.content }];
      }

      if (message.role === "tool") {
        const toolContent = this.parseToolMessageContent(message.content);
        if (!toolContent) {
          return [];
        }

        return [
          {
            role: "tool",
            content: toolContent,
          },
        ];
      }

      return [];
    });
  }

  private parseToolMessageContent(content: string): ToolModelMessage["content"] | undefined {
    const parsed = this.safeJsonParse(content);
    if (!Array.isArray(parsed)) {
      return undefined;
    }

    const toolResults = parsed.flatMap((entry, index) => {
      if (!this.isRecord(entry)) {
        return [];
      }

      const toolName =
        typeof entry.toolName === "string" && entry.toolName.length > 0
          ? entry.toolName
          : "unknown_tool";

      const payload = JSON.stringify({
        args: entry.args ?? null,
        output: entry.output ?? null,
      });

      return [
        {
          type: "tool-result" as const,
          toolCallId: `stored-tool-${index + 1}`,
          toolName,
          output: {
            type: "text" as const,
            value: payload,
          },
        },
      ];
    });

    return toolResults.length > 0 ? toolResults : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  private safeJsonParse(value: string) {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }
}
