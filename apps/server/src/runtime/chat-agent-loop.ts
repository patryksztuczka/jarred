import {
  AgentLoop,
  createInMemoryAgentLoopCheckpointStore,
  type AgentLoopCheckpointStore,
  type AgentLoopEventEmitter,
  type AgentLoopStopReason,
} from "./agent-loop-core";
import {
  buildMemorySystemMessage,
  type ChatLlmService,
  type ChatPromptMessage,
} from "../services/chat/llm-service";
import type { ChatHistoryMessage, ChatMessageService } from "../services/chat/message-service";
import type { RunLoopEventService } from "../services/chat/loop-event-service";

const DEFAULT_MEMORY_RECENT_MESSAGE_COUNT = 8;
const DEFAULT_MAX_ITERATIONS = 1;
const PLANNER_SYSTEM_PROMPT =
  "You are a planning component in an agent loop. Return one concise instruction for an executor that will produce the next assistant reply. Do not return the final user-facing answer. Keep it under 30 words.";
const DEFAULT_EXECUTION_INSTRUCTION =
  "Provide a clear, direct response to the latest user request with concrete details.";
const DEFAULT_REPLAN_FEEDBACK =
  "Previous execution returned an empty answer. Generate an instruction that forces a direct, non-empty response.";

interface ChatAgentLoopState {
  threadId: string;
  correlationId: string;
  prompt: string;
  model: string;
  planFeedback?: string;
  output?: string;
}

interface ChatAgentLoopStep {
  model: string;
  instruction: string;
}

interface ChatAgentLoopObservation {
  output: string;
}

interface CreateChatAgentLoopOptions {
  chatLlmService: ChatLlmService;
  messageService?: ChatMessageService;
  defaultModel: string;
  summaryModel?: string;
  memoryRecentMessageCount?: number;
  maxIterations?: number;
  checkpointStore?: AgentLoopCheckpointStore<ChatAgentLoopState>;
  runLoopEventService: RunLoopEventService;
}

interface RunChatAgentLoopInput {
  sessionId: string;
  threadId: string;
  correlationId: string;
  prompt: string;
  model?: string;
}

export interface ChatAgentLoopRunResult {
  output?: string;
  reason: AgentLoopStopReason;
  iterations: number;
  error?: string;
}

export class ChatAgentLoop {
  private readonly chatLlmService: ChatLlmService;
  private readonly messageService?: ChatMessageService;
  private readonly defaultModel: string;
  private readonly summaryModel?: string;
  private readonly memoryRecentMessageCount: number;
  private readonly maxIterations: number;
  private readonly loop: AgentLoop<ChatAgentLoopState, ChatAgentLoopStep, ChatAgentLoopObservation>;

  public constructor(options: CreateChatAgentLoopOptions) {
    this.chatLlmService = options.chatLlmService;
    this.messageService = options.messageService;
    this.defaultModel = options.defaultModel;
    this.summaryModel = options.summaryModel;
    this.memoryRecentMessageCount = normalizeRecentMessageCount(options.memoryRecentMessageCount);
    this.maxIterations = normalizeMaxIterations(options.maxIterations);

    this.loop = new AgentLoop({
      planner: {
        plan: async ({ state }) => {
          const instruction = await this.generateStepInstruction(state);

          return {
            model: state.model,
            instruction,
          } satisfies ChatAgentLoopStep;
        },
      },
      executor: {
        execute: async ({ state, step }) => {
          const output = await this.generateAssistantOutput(state, step.instruction);
          return {
            output,
          } satisfies ChatAgentLoopObservation;
        },
      },
      evaluator: {
        evaluate: async ({ state, step, observation }) => {
          const output = observation.output.trim();
          const evaluation = await this.chatLlmService.evaluateExecution({
            model: state.model,
            prompt: state.prompt,
            instruction: step.instruction,
            output,
          });

          if (evaluation.answer === "insufficient") {
            return {
              decision: "continue",
              nextState: {
                ...state,
                planFeedback: evaluation.feedback || DEFAULT_REPLAN_FEEDBACK,
              },
            };
          }

          return {
            decision: "finish",
            reason: "success",
            nextState: {
              ...state,
              output,
            },
          };
        },
      },
      checkpointStore:
        options.checkpointStore ?? createInMemoryAgentLoopCheckpointStore<ChatAgentLoopState>(),
      eventEmitter: createRunLoopEventEmitter(options.runLoopEventService),
    });
  }

  public async run(input: RunChatAgentLoopInput) {
    const initialState = {
      threadId: input.threadId,
      correlationId: input.correlationId,
      prompt: input.prompt,
      model: input.model || this.defaultModel,
      planFeedback: undefined,
      output: undefined,
    } satisfies ChatAgentLoopState;

    const result = await this.loop.run({
      sessionId: input.sessionId,
      initialState,
      maxIterations: this.maxIterations,
      resumeFromCheckpoint: false,
    });

    return {
      output: result.state.output,
      reason: result.reason,
      iterations: result.iterations,
      error: result.error,
    } satisfies ChatAgentLoopRunResult;
  }

  private async generateStepInstruction(state: ChatAgentLoopState) {
    const threadMessages = await this.getThreadMessages(state.threadId);
    const recentMessages = buildRecentPromptMessages(threadMessages, this.memoryRecentMessageCount);
    const olderMessages = buildOlderPromptMessages(threadMessages, this.memoryRecentMessageCount);

    const hasCurrentPromptMessage = threadMessages.some((message) => {
      return message.correlationId === state.correlationId && message.role === "user";
    });

    if (!hasCurrentPromptMessage) {
      recentMessages.push({
        role: "user",
        content: state.prompt,
      });
    }

    const plannerMessages: ChatPromptMessage[] = [
      {
        role: "system",
        content: PLANNER_SYSTEM_PROMPT,
      },
    ];

    if (olderMessages.length > 0) {
      const summary = await this.chatLlmService.summarizeConversation({
        model: this.summaryModel || state.model,
        messages: olderMessages,
      });

      if (summary) {
        plannerMessages.push(buildMemorySystemMessage(summary));
      }
    }

    if (state.planFeedback) {
      plannerMessages.push({
        role: "system",
        content: `Planning feedback: ${state.planFeedback}`,
      });
    }

    plannerMessages.push(...recentMessages);

    const plannedInstruction = await this.chatLlmService.generateAssistantResponse({
      model: state.model,
      messages: plannerMessages,
    });
    const instruction = plannedInstruction.trim();

    if (!instruction) {
      return DEFAULT_EXECUTION_INSTRUCTION;
    }

    return instruction;
  }

  private async generateAssistantOutput(state: ChatAgentLoopState, instruction: string) {
    const threadMessages = await this.getThreadMessages(state.threadId);
    const recentMessages = buildRecentPromptMessages(threadMessages, this.memoryRecentMessageCount);

    const hasCurrentPromptMessage = threadMessages.some((message) => {
      return message.correlationId === state.correlationId && message.role === "user";
    });

    if (!hasCurrentPromptMessage) {
      recentMessages.push({
        role: "user",
        content: state.prompt,
      });
    }

    const olderMessages = buildOlderPromptMessages(threadMessages, this.memoryRecentMessageCount);
    const summaryModel = this.summaryModel || state.model;

    if (olderMessages.length > 0) {
      const summary = await this.chatLlmService.summarizeConversation({
        model: summaryModel,
        messages: olderMessages,
      });

      if (summary) {
        return this.chatLlmService.generateAssistantResponse({
          model: state.model,
          messages: [
            buildExecutionInstructionSystemMessage(instruction),
            buildMemorySystemMessage(summary),
            ...recentMessages,
          ],
        });
      }
    }

    if (recentMessages.length === 0) {
      recentMessages.push({
        role: "user",
        content: state.prompt,
      });
    }

    return this.chatLlmService.generateAssistantResponse({
      model: state.model,
      messages: [buildExecutionInstructionSystemMessage(instruction), ...recentMessages],
    });
  }

  private async getThreadMessages(threadId: string) {
    if (!this.messageService) {
      return [];
    }

    return this.messageService.listMessagesByThreadId(threadId);
  }
}

const normalizeRecentMessageCount = (value: number | undefined) => {
  if (!value || Number.isNaN(value)) {
    return DEFAULT_MEMORY_RECENT_MESSAGE_COUNT;
  }

  return Math.max(1, Math.floor(value));
};

const normalizeMaxIterations = (value: number | undefined) => {
  if (!value || Number.isNaN(value) || value < 1) {
    return DEFAULT_MAX_ITERATIONS;
  }

  return Math.floor(value);
};

const toPromptMessage = (message: ChatHistoryMessage) => {
  return {
    role: message.role,
    content: message.content,
  } satisfies ChatPromptMessage;
};

const buildRecentPromptMessages = (messages: ChatHistoryMessage[], recentMessageCount: number) => {
  if (messages.length <= recentMessageCount) {
    return messages.map((message) => {
      return toPromptMessage(message);
    });
  }

  return messages.slice(-recentMessageCount).map((message) => {
    return toPromptMessage(message);
  });
};

const buildOlderPromptMessages = (messages: ChatHistoryMessage[], recentMessageCount: number) => {
  if (messages.length <= recentMessageCount) {
    return [];
  }

  return messages.slice(0, -recentMessageCount).map((message) => {
    return toPromptMessage(message);
  });
};

const buildExecutionInstructionSystemMessage = (instruction: string) => {
  return {
    role: "system",
    content: `Execution instruction: ${instruction}`,
  } satisfies ChatPromptMessage;
};

const createRunLoopEventEmitter = (runLoopEventService: RunLoopEventService) => {
  return {
    emit: async (event) => {
      await runLoopEventService.appendEvent({
        runId: event.sessionId,
        iteration: event.iteration,
        eventType: event.type,
        decision: event.decision,
        reason: event.reason,
        payload: {
          state: event.state,
          step: event.step,
          observation: event.observation,
          decision: event.decision,
          reason: event.reason,
          error: event.error,
        },
      });
    },
  } satisfies AgentLoopEventEmitter<
    ChatAgentLoopState,
    ChatAgentLoopStep,
    ChatAgentLoopObservation
  >;
};
