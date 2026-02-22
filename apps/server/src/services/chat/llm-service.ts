import { generateText, type ModelMessage } from "ai";
import { openai } from "@ai-sdk/openai";

export interface ChatPromptMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface GenerateAssistantResponseInput {
  model: string;
  messages: ChatPromptMessage[];
}

export interface ChatLlmService {
  generateAssistantResponse(input: GenerateAssistantResponseInput): Promise<string>;
}

const mapMessagesToCoreMessages = (messages: ChatPromptMessage[]) => {
  return messages.map((message) => {
    return {
      role: message.role,
      content: message.content,
    } satisfies ModelMessage;
  });
};

const generateAssistantResponseWithAiSdk = async (input: GenerateAssistantResponseInput) => {
  const result = await generateText({
    model: openai(input.model),
    messages: mapMessagesToCoreMessages(input.messages),
  });

  return result.text.trim();
};

const generateAssistantResponseWithFallback = async (input: GenerateAssistantResponseInput) => {
  const lastUserMessage = input.messages.toReversed().find((message) => message.role === "user");

  return `Handled prompt: ${lastUserMessage?.content ?? ""}`;
};

export const createAiSdkChatLlmService = () => {
  return {
    generateAssistantResponse: generateAssistantResponseWithAiSdk,
  } satisfies ChatLlmService;
};

export const createFallbackChatLlmService = () => {
  return {
    generateAssistantResponse: generateAssistantResponseWithFallback,
  } satisfies ChatLlmService;
};
