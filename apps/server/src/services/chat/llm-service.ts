import { z } from "zod";
import { LangfuseClient } from "@langfuse/client";
import { openai } from "@ai-sdk/openai";
import {
  Output,
  generateText,
  type AssistantModelMessage,
  type ModelMessage,
  type ToolModelMessage,
} from "ai";
import { getWeather } from "../../agent/tools/weather-tool";

const LANGFUSE_PROMPT_NAME = "jarred-system-prompt";
const LANGFUSE_PROMPT_LABEL = "production";
const SYSTEM_PROMPT_CACHE_TTL_SECONDS = 60;

const langfuse = new LangfuseClient();

const getCurrentDateString = () => new Date().toISOString().slice(0, 10);

interface GenerateAssistantResponseInput {
  model: string;
  messages: ModelMessage[];
}

const assistantLlmOutputSchema = z.object({
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

const resolveSystemPromptFromLangfuse = async () => {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;

  if (!publicKey || !secretKey) {
    return undefined;
  }

  const prompt = await langfuse.prompt.get(LANGFUSE_PROMPT_NAME, {
    type: "text",
    label: LANGFUSE_PROMPT_LABEL,
    cacheTtlSeconds: SYSTEM_PROMPT_CACHE_TTL_SECONDS,
  });

  return prompt.compile({
    date: getCurrentDateString(),
  });
};

const getSystemPrompt = async () => {
  try {
    return await resolveSystemPromptFromLangfuse();
  } catch (error) {
    const safeError = error instanceof Error ? error.message : "unknown";
    console.error(`Failed to fetch system prompt from Langfuse: ${safeError}`);

    return undefined;
  }
};

export type AssistantResponse = AssistantActionResponse | ToolActionResponse;

export interface LlmService {
  generateAssistantResponse(input: GenerateAssistantResponseInput): Promise<AssistantResponse>;
}

const stringifyForMarkdown = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "{}";
  }
};

const formatModelMessageContent = (content: unknown) => {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return `\`\`\`json\n${stringifyForMarkdown(content)}\n\`\`\``;
  }

  return content
    .map((part, index) => {
      if (!part || typeof part !== "object") {
        return `- part ${index + 1}: ${stringifyForMarkdown(part)}`;
      }

      const typedPart = part as { type?: unknown };
      if (typedPart.type === "text") {
        const textPart = part as { text?: unknown };
        return `- text:\n${typeof textPart.text === "string" ? textPart.text : stringifyForMarkdown(textPart)}`;
      }

      return `- ${typedPart.type ?? "part"}:\n\`\`\`json\n${stringifyForMarkdown(part)}\n\`\`\``;
    })
    .join("\n");
};

const combineMessagesAsMarkdown = (messages: ModelMessage[]) => {
  const blocks = messages.map((message, index) => {
    return [
      `## Message ${index + 1}`,
      `Role: ${message.role}`,
      "",
      formatModelMessageContent(message.content),
    ].join("\n");
  });

  return [
    "# Conversation Transcript",
    "",
    ...blocks,
    "",
    "## Instruction",
    "Respond to the latest user request while considering relevant prior context.",
  ].join("\n");
};

const generateAssistantResponseWithAiSdk = async (input: GenerateAssistantResponseInput) => {
  const systemPrompt = await getSystemPrompt();
  const combinedPrompt = combineMessagesAsMarkdown(input.messages);
  const messages = systemPrompt
    ? [
        {
          role: "system" as const,
          content: systemPrompt,
        },
        {
          role: "user" as const,
          content: combinedPrompt,
        },
      ]
    : [
        {
          role: "user" as const,
          content: combinedPrompt,
        },
      ];

  console.log("Calling LLM...");
  const result = await generateText({
    model: openai(input.model),
    messages,
    output: Output.object({ schema: assistantLlmOutputSchema }),
    tools: {
      getWeather,
    },
    experimental_telemetry: { isEnabled: true },
  });

  if (result.toolResults.length > 0) {
    const toolResult = result.toolResults.at(0);
    if (!toolResult) {
      throw new Error("Tool results are present but empty");
    }

    const toolPayload = JSON.stringify({
      args: toolResult.input,
      output: toolResult.output,
    });

    const toolMessage: ToolModelMessage = {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: toolResult.toolCallId,
          toolName: toolResult.toolName,
          output: {
            type: "text",
            value: toolPayload,
          },
        },
      ],
    };

    return {
      action: "continue" as const,
      message: toolMessage,
    };
  }

  const assistantMessage: AssistantModelMessage = {
    role: "assistant",
    content: result.output.response ?? "No content",
  };

  return {
    action: result.output.action,
    message: assistantMessage,
  };
};

export const createAiSdkChatLlmService = () => {
  return {
    generateAssistantResponse: generateAssistantResponseWithAiSdk,
  } satisfies LlmService;
};
