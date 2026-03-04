import type { ModelMessage } from "ai";

import type { AssistantResponse, LlmService } from "../modules/llm/llm-schemas";

interface CreateAgentLoopOptions {
  llmService: LlmService;
  model: string;
  maxIterations: number;
}

interface RunAgentLoopInput {
  runId: string;
  threadId: string;
  messages: ModelMessage[];
}

export type AgentLoopStopReason = "success" | "max_iterations_reached" | "error";

export type AgentLoopEvent =
  | {
      type: "loop.started";
      payload: {
        runId: string;
        threadId: string;
      };
    }
  | {
      type: "assistant.generated";
      payload: {
        runId: string;
        threadId: string;
        response: AssistantResponse;
      };
    }
  | {
      type: "loop.completed";
      payload: {
        runId: string;
        threadId: string;
        reason: Exclude<AgentLoopStopReason, "error">;
        output: AssistantResponse;
      };
    }
  | {
      type: "loop.error";
      payload: {
        runId: string;
        threadId: string;
        reason: "error";
        error: string;
      };
    };

interface AgentLoopRunOptions {
  onEvent?: (event: AgentLoopEvent) => Promise<void> | void;
}

export interface AgentLoopRunResult {
  output?: AssistantResponse;
  reason: AgentLoopStopReason;
  error?: string;
}

export class AgentLoop {
  private readonly llmService: LlmService;
  private readonly model: string;
  private readonly maxIterations: number;

  public constructor(options: CreateAgentLoopOptions) {
    this.llmService = options.llmService;
    this.model = options.model;
    this.maxIterations = options.maxIterations;
  }

  public async run(input: RunAgentLoopInput, options: AgentLoopRunOptions = {}) {
    const onEvent = options.onEvent;

    await onEvent?.({
      type: "loop.started",
      payload: {
        runId: input.runId,
        threadId: input.threadId,
      },
    });

    try {
      const promptMessages = [...input.messages];

      let output: AssistantResponse | undefined;
      let iterationsCalled = 0;

      do {
        output = await this.llmService.generateAssistantResponse({
          model: this.model,
          messages: promptMessages,
        });

        iterationsCalled += 1;
        promptMessages.push(output.message);

        await onEvent?.({
          type: "assistant.generated",
          payload: {
            runId: input.runId,
            threadId: input.threadId,
            response: output,
          },
        });
      } while (iterationsCalled < this.maxIterations && output.action === "continue");

      if (!output) {
        throw new Error("Loop finished without assistant output");
      }

      const reason = output.action === "finish" ? "success" : "max_iterations_reached";

      await onEvent?.({
        type: "loop.completed",
        payload: {
          runId: input.runId,
          threadId: input.threadId,
          reason,
          output,
        },
      });

      return {
        output,
        reason,
      } satisfies AgentLoopRunResult;
    } catch (error) {
      const safeError = error instanceof Error ? error.message : "unknown";

      await onEvent?.({
        type: "loop.error",
        payload: {
          runId: input.runId,
          threadId: input.threadId,
          reason: "error",
          error: safeError,
        },
      });

      return {
        reason: "error",
        error: safeError,
      } satisfies AgentLoopRunResult;
    }
  }
}
