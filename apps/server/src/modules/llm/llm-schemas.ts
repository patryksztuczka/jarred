import { z } from "zod";
import type { AssistantModelMessage, ModelMessage, ToolModelMessage } from "ai";

export interface GenerateAssistantResponseInput {
  model: string;
  messages: ModelMessage[];
}

export const assistantLlmOutputSchema = z.object({
  action: z.enum(["continue", "finish"]),
  response: z.string().min(1).nullable(),
});

interface AssistantActionResponse {
  message: AssistantModelMessage;
  action: "continue" | "finish";
}

interface ToolActionResponse {
  message: ToolModelMessage;
  action: "continue";
}

export type AssistantResponse = AssistantActionResponse | ToolActionResponse;

export interface LlmService {
  generateAssistantResponse(input: GenerateAssistantResponseInput): Promise<AssistantResponse>;
}
