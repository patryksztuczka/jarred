import { type ChatLlmService, type ChatPromptMessage } from "../services/chat/llm-service";
import type { ChatHistoryMessage, ChatMessageService } from "../services/chat/message-service";
import type {
  AgentLoopStopReason,
  RunLoopEventService,
  RunLoopEventType,
} from "../services/chat/loop-event-service";

const DEFAULT_RECENT_MESSAGE_COUNT = 10;

interface CreateAgentLoopOptions {
  llmService: ChatLlmService;
  messageService?: ChatMessageService;
  defaultModel: string;
  recentMessageCount?: number;
  runLoopEventService: RunLoopEventService;
}

interface RunAgentLoopInput {
  runId: string;
  threadId: string;
  correlationId: string;
  prompt: string;
  model?: string;
}

export interface AgentLoopRunResult {
  output?: string;
  reason: AgentLoopStopReason;
  error?: string;
}

export class AgentLoop {
  private readonly llmService: ChatLlmService;
  private readonly messageService?: ChatMessageService;
  private readonly defaultModel: string;
  private readonly recentMessageCount: number;
  private readonly runLoopEventService: RunLoopEventService;

  public constructor(options: CreateAgentLoopOptions) {
    this.llmService = options.llmService;
    this.messageService = options.messageService;
    this.defaultModel = options.defaultModel;
    this.recentMessageCount = normalizeRecentMessageCount(options.recentMessageCount);
    this.runLoopEventService = options.runLoopEventService;
  }

  public async run(input: RunAgentLoopInput) {
    const model = input.model || this.defaultModel;

    await this.emitEvent({
      runId: input.runId,
      eventType: "loop.started",
      payload: { threadId: input.threadId, prompt: input.prompt },
    });

    try {
      const threadMessages = await this.getThreadMessages(input.threadId, this.recentMessageCount);
      const recentMessages = threadMessages.map((message) => {
        return toPromptMessage(message);
      });

      const hasCurrentPromptMessage = threadMessages.some((message) => {
        return message.correlationId === input.correlationId && message.role === "user";
      });

      if (!hasCurrentPromptMessage) {
        recentMessages.push({
          role: "user",
          content: input.prompt,
        });
      }

      const output = await this.llmService.generateAssistantResponse({
        model,
        messages: recentMessages,
      });

      await this.emitEvent({
        runId: input.runId,
        eventType: "loop.completed",
        payload: { output },
      });

      return {
        output,
        reason: "success" as const,
      } satisfies AgentLoopRunResult;
    } catch (error) {
      const safeError = error instanceof Error ? error.message : "unknown";

      await this.emitEvent({
        runId: input.runId,
        eventType: "loop.error",
        payload: { error: safeError },
      });

      return {
        reason: "error" as const,
        error: safeError,
      } satisfies AgentLoopRunResult;
    }
  }

  private async getThreadMessages(threadId: string, limit?: number) {
    if (!this.messageService) {
      return [];
    }

    return this.messageService.listMessagesByThreadId(threadId, limit);
  }

  private async emitEvent(input: { runId: string; eventType: RunLoopEventType; payload: unknown }) {
    await this.runLoopEventService.appendEvent({
      runId: input.runId,
      eventType: input.eventType,
      payload: input.payload,
    });
  }
}

const normalizeRecentMessageCount = (value: number | undefined) => {
  if (!value || Number.isNaN(value)) {
    return DEFAULT_RECENT_MESSAGE_COUNT;
  }

  return Math.max(1, Math.floor(value));
};

const toPromptMessage = (message: ChatHistoryMessage) => {
  return {
    role: message.role,
    content: message.content,
  } satisfies ChatPromptMessage;
};
