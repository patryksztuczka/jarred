import { describe, expect, test } from "bun:test";
import { AgentLoop } from "../../../src/agent/agent-loop";
import type { ChatLlmService } from "../../../src/services/chat/llm-service";
import type {
  RunLoopEventService,
  RunLoopEventType,
} from "../../../src/services/chat/loop-event-service";

describe("AgentLoop", () => {
  test("retries while action is continue and stops on finish", async () => {
    const llmCalls: Array<Array<{ role: string; content: string }>> = [];
    let callCount = 0;

    const llmService: ChatLlmService = {
      generateAssistantResponse: async (input) => {
        llmCalls.push(
          input.messages.map((message) => {
            return {
              role: message.role,
              content: message.content,
            };
          }),
        );

        callCount += 1;

        if (callCount === 1) {
          return {
            action: "continue",
            response: "Need one more step",
            toolExecutions: [],
          };
        }

        return {
          action: "finish",
          response: "Done",
          toolExecutions: [],
        };
      },
    };

    const loopEvents: Array<{ eventType: RunLoopEventType; payload: unknown }> = [];
    const runLoopEventService: RunLoopEventService = {
      appendEvent: async (input) => {
        loopEvents.push({
          eventType: input.eventType,
          payload: input.payload,
        });
      },
      listByRunId: async () => {
        return [];
      },
    };

    const agentLoop = new AgentLoop({
      llmService,
      defaultModel: "gpt-4o-mini",
      maxIterations: 4,
      runLoopEventService,
    });

    const result = await agentLoop.run({
      runId: "run_loop_continue_1",
      threadId: "thr_loop_continue_1",
      prompt: "Help me solve this",
    });

    expect(result.reason).toBe("success");
    expect(result.output?.response).toBe("Done");
    expect(llmCalls).toHaveLength(2);
    expect(llmCalls[1]?.at(-1)).toEqual({
      role: "assistant",
      content: "Need one more step",
    });

    expect(loopEvents).toHaveLength(2);
    expect(loopEvents[0]?.eventType).toBe("loop.started");
    expect(loopEvents[1]?.eventType).toBe("loop.completed");
    expect(loopEvents[1]?.payload).toEqual({
      output: {
        action: "finish",
        response: "Done",
        toolExecutions: [],
      },
      iterationsCalled: 2,
    });
  });

  test("stops with max_iterations_reached when continue never ends", async () => {
    const llmService: ChatLlmService = {
      generateAssistantResponse: async () => {
        return {
          action: "continue",
          response: "Still working",
          toolExecutions: [],
        };
      },
    };

    const loopEvents: Array<{ eventType: RunLoopEventType; payload: unknown }> = [];
    const runLoopEventService: RunLoopEventService = {
      appendEvent: async (input) => {
        loopEvents.push({
          eventType: input.eventType,
          payload: input.payload,
        });
      },
      listByRunId: async () => {
        return [];
      },
    };

    const agentLoop = new AgentLoop({
      llmService,
      defaultModel: "gpt-4o-mini",
      maxIterations: 2,
      runLoopEventService,
    });

    const result = await agentLoop.run({
      runId: "run_loop_limit_1",
      threadId: "thr_loop_limit_1",
      prompt: "Keep going",
    });

    expect(result.reason).toBe("max_iterations_reached");
    expect(result.output?.action).toBe("continue");
    expect(loopEvents[1]?.eventType).toBe("loop.completed");
    expect(loopEvents[1]?.payload).toEqual({
      output: {
        action: "continue",
        response: "Still working",
        toolExecutions: [],
      },
      iterationsCalled: 2,
      reason: "max_iterations_reached",
    });
  });
});
