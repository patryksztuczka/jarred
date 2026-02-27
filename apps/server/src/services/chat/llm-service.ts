import { z } from "zod";
import { openai } from "@ai-sdk/openai";
import { Output, generateText, type ModelMessage } from "ai";

interface GenerateAssistantResponseInput {
  model: string;
  messages: ModelMessage[];
}

const assistantResponseSchema = z.object({
  action: z.enum(["continue", "finish", "ask_clarification"]),
  reasoning: z.string().min(1).nullable(),
  response: z.string().min(1).nullable(),
});

export type AssistantResponse = z.infer<typeof assistantResponseSchema>;

export interface LlmService {
  generateAssistantResponse(input: GenerateAssistantResponseInput): Promise<AssistantResponse>;
}

const generateAssistantResponseWithAiSdk = async (input: GenerateAssistantResponseInput) => {
  const result = await generateText({
    model: openai(input.model),
    messages: input.messages,
    output: Output.object({ schema: assistantResponseSchema }),
  });

  return result.output;
};

export const createAiSdkChatLlmService = () => {
  return {
    generateAssistantResponse: generateAssistantResponseWithAiSdk,
  } satisfies LlmService;
};
