import {
  type AssistantResponse,
  type LlmService,
  type ChatPromptMessage,
} from "../services/chat/llm-service";
import type { ChatHistoryMessage, MessageService } from "../services/chat/message-service";
import type {
  AgentLoopStopReason,
  RunLoopEventService,
  RunLoopEventType,
} from "../services/chat/loop-event-service";

interface CreateAgentLoopOptions {
  llmService: LlmService;
  messageService: MessageService;
  runLoopEventService: RunLoopEventService;
  model: string;
  recentMessageCount: number;
  maxIterations: number;
}

interface RunAgentLoopInput {
  runId: string;
  threadId: string;
  correlationId: string;
  prompt: string;
}

export interface AgentLoopRunResult {
  output?: AssistantResponse;
  reason: AgentLoopStopReason;
  error?: string;
}

export class AgentLoop {
  private readonly llmService: LlmService;
  private readonly messageService: MessageService;
  private readonly runLoopEventService: RunLoopEventService;
  private readonly model: string;
  private readonly recentMessageCount: number;
  private readonly maxIterations: number;

  public constructor(options: CreateAgentLoopOptions) {
    this.llmService = options.llmService;
    this.messageService = options.messageService;
    this.model = options.model;
    this.recentMessageCount = options.recentMessageCount;
    this.maxIterations = options.maxIterations;
    this.runLoopEventService = options.runLoopEventService;
  }

  public async run(input: RunAgentLoopInput) {
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

      let output: AssistantResponse | undefined;
      let iterationsCalled = 0;

      while (iterationsCalled < this.maxIterations) {
        output = await this.llmService.generateAssistantResponse({
          model: this.model,
          messages: recentMessages,
        });

        iterationsCalled += 1;

        console.log(output);

        if (output.action !== "continue") {
          await this.emitEvent({
            runId: input.runId,
            eventType: "loop.completed",
            payload: { output, iterationsCalled },
          });

          return {
            output,
            reason: "success" as const,
          } satisfies AgentLoopRunResult;
        }

        const continuationMessage = toAssistantContinuationMessage(output);
        if (continuationMessage) {
          recentMessages.push({
            role: "assistant",
            content: continuationMessage,
          });
        }
      }

      await this.emitEvent({
        runId: input.runId,
        eventType: "loop.completed",
        payload: {
          output,
          iterationsCalled: this.maxIterations,
          reason: "max_iterations_reached",
        },
      });

      return {
        output,
        reason: "max_iterations_reached" as const,
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

const toAssistantContinuationMessage = (output: AssistantResponse) => {
  const response = output.response?.trim();
  if (response && response.length > 0) {
    return response;
  }

  if (output.toolExecutions.length > 0) {
    return JSON.stringify(output.toolExecutions);
  }

  return undefined;
};

const toPromptMessage = (message: ChatHistoryMessage) => {
  return {
    role: message.role,
    content: message.content,
  } satisfies ChatPromptMessage;
};
