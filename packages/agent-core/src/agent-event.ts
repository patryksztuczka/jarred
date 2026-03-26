import type { AssistantModelMessage, ToolModelMessage } from "ai";

export type AgentEvent =
  | { type: "agent.start"; model: string }
  | { type: "agent.reasoning.start"; iteration: number }
  | { type: "agent.reasoning.delta"; delta: string; iteration: number }
  | { type: "agent.reasoning.end"; iteration: number }
  | { type: "agent.token"; delta: string; iteration: number }
  | { type: "tool.start"; toolName: string; args: unknown; iteration: number }
  | { type: "tool.end"; toolName: string; result: unknown; iteration: number }
  | { type: "message.complete"; message: AssistantModelMessage | ToolModelMessage }
  | { type: "agent.end"; reason: AgentStopReason; error?: string };

export type AgentStopReason = "finish" | "max_iterations" | "error";
