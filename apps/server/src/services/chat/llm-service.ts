import { z } from "zod";
import { openai } from "@ai-sdk/openai";
import { Output, generateText, type ModelMessage } from "ai";

export interface ChatPromptMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface GenerateAssistantResponseInput {
  model: string;
  messages: ChatPromptMessage[];
}

const assistantResponseSchema = z.object({
  action: z.enum(["continue", "finish", "ask_clarification"]),
  reasoning: z.string().min(1).nullable(),
  response: z.string().min(1).nullable(),
});

interface AssistantResponseBase {
  action: "continue" | "finish" | "ask_clarification";
  reasoning?: string | null;
  response?: string | null;
}

export interface AssistantToolExecution {
  toolName: string;
  args: unknown;
  result?: unknown;
  error?: string;
}

export interface AssistantResponse extends AssistantResponseBase {
  toolExecutions: AssistantToolExecution[];
}

export interface LlmService {
  generateAssistantResponse(input: GenerateAssistantResponseInput): Promise<AssistantResponse>;
}

const mapMessagesToCoreMessages = (messages: ChatPromptMessage[]): ModelMessage[] => {
  return messages.map((message) => {
    return {
      role: message.role,
      content: message.content,
    };
  });
};

const extractToolExecutions = (
  steps: Array<{
    toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>;
    toolResults: Array<{ toolCallId: string; output?: unknown; errorText?: string }>;
  }>,
) => {
  const toolResultsById = new Map<string, { output?: unknown; error?: string }>();

  for (const step of steps) {
    for (const toolResult of step.toolResults) {
      toolResultsById.set(toolResult.toolCallId, {
        output: toolResult.output,
        error: toolResult.errorText,
      });
    }
  }

  return steps.flatMap((step) => {
    return step.toolCalls.map((toolCall) => {
      const toolResult = toolResultsById.get(toolCall.toolCallId);

      return {
        toolName: toolCall.toolName,
        args: toolCall.input,
        result: toolResult?.output,
        error: toolResult?.error,
      } satisfies AssistantToolExecution;
    });
  });
};

const generateAssistantResponseWithAiSdk = async (input: GenerateAssistantResponseInput) => {
  const result = await generateText({
    model: openai(input.model),
    messages: mapMessagesToCoreMessages(input.messages),
    output: Output.object({ schema: assistantResponseSchema }),
  });

  const output = result.output;

  const toolExecutions = extractToolExecutions(result.steps);
  return {
    ...output,
    toolExecutions,
  };
};

export const createAiSdkChatLlmService = () => {
  return {
    generateAssistantResponse: generateAssistantResponseWithAiSdk,
  } satisfies LlmService;
};
