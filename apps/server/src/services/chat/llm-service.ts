import { generateObject, generateText, type ModelMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

export interface ChatPromptMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface GenerateAssistantResponseInput {
  model: string;
  messages: ChatPromptMessage[];
}

interface SummarizeConversationInput {
  model: string;
  previousSummary?: string;
  messages: ChatPromptMessage[];
}

interface EvaluateExecutionInput {
  model: string;
  prompt: string;
  instruction: string;
  output: string;
}

export interface EvaluateExecutionResult {
  answer: "sufficient" | "insufficient";
  feedback: string;
}

export interface ChatLlmService {
  generateAssistantResponse(input: GenerateAssistantResponseInput): Promise<string>;
  summarizeConversation(input: SummarizeConversationInput): Promise<string>;
  evaluateExecution(input: EvaluateExecutionInput): Promise<EvaluateExecutionResult>;
}

const mapMessagesToCoreMessages = (messages: ChatPromptMessage[]) => {
  return messages.map((message) => {
    return {
      role: message.role,
      content: message.content,
    } satisfies ModelMessage;
  });
};

const SUMMARIZATION_INSTRUCTION =
  "You maintain compact memory for a chat thread. Summarize durable goals, decisions, constraints, open questions, and useful facts. Keep it concise and factual.";

const ASSISTANT_MEMORY_INSTRUCTION =
  "Use the conversation summary as persistent context, then prioritize the recent messages for immediate intent.";

const EXECUTION_EVALUATION_INSTRUCTION =
  "Evaluate if the executor output sufficiently answers the user prompt while following the instruction. Return structured judgment only.";

const executionEvaluationSchema = z.object({
  answer: z.enum(["sufficient", "insufficient"]),
  feedback: z.string().min(1).max(240),
});

const generateAssistantResponseWithAiSdk = async (input: GenerateAssistantResponseInput) => {
  const result = await generateText({
    model: openai(input.model),
    messages: mapMessagesToCoreMessages(input.messages),
  });

  return result.text.trim();
};

const summarizeConversationWithAiSdk = async (input: SummarizeConversationInput) => {
  const summaryPromptParts = [
    input.previousSummary
      ? `Existing summary:\n${input.previousSummary}`
      : "Existing summary: (none)",
    "Messages to fold into memory:",
    ...input.messages.map((message) => {
      return `${message.role.toUpperCase()}: ${message.content}`;
    }),
    "Return only the updated summary in plain text.",
  ];

  const result = await generateText({
    model: openai(input.model),
    messages: [
      {
        role: "system",
        content: SUMMARIZATION_INSTRUCTION,
      },
      {
        role: "user",
        content: summaryPromptParts.join("\n\n"),
      },
    ],
  });

  return result.text.trim();
};

const evaluateExecutionWithAiSdk = async (input: EvaluateExecutionInput) => {
  const result = await generateObject({
    model: openai(input.model),
    schema: executionEvaluationSchema,
    messages: [
      {
        role: "system",
        content: EXECUTION_EVALUATION_INSTRUCTION,
      },
      {
        role: "user",
        content: [
          `Prompt:\n${input.prompt}`,
          `Instruction:\n${input.instruction}`,
          `Executor output:\n${input.output}`,
          "Mark as insufficient when output is empty, too vague, or misses the prompt.",
        ].join("\n\n"),
      },
    ],
  });

  return result.object satisfies EvaluateExecutionResult;
};

const summarizeConversationWithFallback = async (input: SummarizeConversationInput) => {
  const transcript = input.messages
    .map((message) => {
      return `${message.role}: ${message.content}`;
    })
    .join("\n");

  const prefix = input.previousSummary ? `${input.previousSummary}\n` : "";
  return `${prefix}${transcript}`.trim();
};

const generateAssistantResponseWithFallback = async (input: GenerateAssistantResponseInput) => {
  const lastUserMessage = input.messages.toReversed().find((message) => message.role === "user");

  return `Handled prompt: ${lastUserMessage?.content ?? ""}`;
};

const evaluateExecutionWithFallback = async (input: EvaluateExecutionInput) => {
  const output = input.output.trim();

  if (!output) {
    return {
      answer: "insufficient",
      feedback: "Output was empty. Generate a direct, non-empty answer.",
    } satisfies EvaluateExecutionResult;
  }

  return {
    answer: "sufficient",
    feedback: "Output is acceptable.",
  } satisfies EvaluateExecutionResult;
};

export const createAiSdkChatLlmService = () => {
  return {
    generateAssistantResponse: generateAssistantResponseWithAiSdk,
    summarizeConversation: summarizeConversationWithAiSdk,
    evaluateExecution: evaluateExecutionWithAiSdk,
  } satisfies ChatLlmService;
};

export const createFallbackChatLlmService = () => {
  return {
    generateAssistantResponse: generateAssistantResponseWithFallback,
    summarizeConversation: summarizeConversationWithFallback,
    evaluateExecution: evaluateExecutionWithFallback,
  } satisfies ChatLlmService;
};

export const buildMemorySystemMessage = (summary: string) => {
  return {
    role: "system",
    content: `${ASSISTANT_MEMORY_INSTRUCTION}\n\nConversation summary:\n${summary}`,
  } satisfies ChatPromptMessage;
};
