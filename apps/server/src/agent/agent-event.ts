import type { AssistantModelMessage, ToolModelMessage } from "ai";

export type AgentEvent =
  | { type: "agent.start"; model: string }
  | { type: "agent.token"; delta: string; iteration: number }
  | { type: "tool.start"; toolName: string; iteration: number }
  | { type: "tool.end"; toolName: string; result: unknown; iteration: number }
  | { type: "message.complete"; message: AssistantModelMessage | ToolModelMessage }
  | { type: "agent.end"; reason: AgentStopReason; error?: string };

export type AgentStopReason = "finish" | "max_iterations" | "error";
