import { openai } from "@ai-sdk/openai";
import {
  Output,
  generateText,
  type AssistantModelMessage,
  type ModelMessage,
  type ToolModelMessage,
} from "ai";

import { getWeather } from "../../agent/tools/weather-tool";
import { type LangfusePromptService, LangfuseService } from "./langfuse-service";
import {
  type GenerateAssistantResponseInput,
  assistantLlmOutputSchema,
  type LlmService,
} from "./llm-schemas";

export class AiSdkLlmService implements LlmService {
  private readonly tools = {
    getWeather,
  };

  constructor(private readonly langfuseService: LangfusePromptService = new LangfuseService()) {}

  async generateAssistantResponse(input: GenerateAssistantResponseInput) {
    const messages = await this.buildPromptMessages(input.messages);

    console.log("Calling LLM...");
    const result = await generateText({
      model: openai(input.model),
      messages,
      output: Output.object({ schema: assistantLlmOutputSchema }),
      tools: this.tools,
      experimental_telemetry: { isEnabled: true },
    });

    const toolResult = result.toolResults.at(0);
    if (toolResult) {
      return this.buildToolActionResponse(toolResult);
    }

    return this.buildAssistantActionResponse(result.output.action, result.output.response);
  }

  private async buildPromptMessages(messages: ModelMessage[]) {
    const systemPrompt = await this.langfuseService.getSystemPrompt();
    const combinedPrompt = this.combineMessagesAsMarkdown(messages);

    return systemPrompt
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
  }

  private buildToolActionResponse(toolResult: {
    toolCallId: string;
    toolName: string;
    input: unknown;
    output: unknown;
  }) {
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

  private buildAssistantActionResponse(action: "continue" | "finish", response: string | null) {
    const assistantMessage: AssistantModelMessage = {
      role: "assistant",
      content: response ?? "No content",
    };

    return {
      action,
      message: assistantMessage,
    };
  }

  private combineMessagesAsMarkdown(messages: ModelMessage[]) {
    const blocks = messages.map((message, index) => {
      return [
        `## Message ${index + 1}`,
        `Role: ${message.role}`,
        "",
        this.formatModelMessageContent(message.content),
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
  }

  private formatModelMessageContent(content: unknown) {
    if (typeof content === "string") {
      return content;
    }

    if (!Array.isArray(content)) {
      return `\`\`\`json\n${this.stringifyForMarkdown(content)}\n\`\`\``;
    }

    return content
      .map((part, index) => {
        if (!part || typeof part !== "object") {
          return `- part ${index + 1}: ${this.stringifyForMarkdown(part)}`;
        }

        const typedPart = part as { type?: unknown };
        if (typedPart.type === "text") {
          const textPart = part as { text?: unknown };
          return `- text:\n${typeof textPart.text === "string" ? textPart.text : this.stringifyForMarkdown(textPart)}`;
        }

        return `- ${typedPart.type ?? "part"}:\n\`\`\`json\n${this.stringifyForMarkdown(part)}\n\`\`\``;
      })
      .join("\n");
  }

  private stringifyForMarkdown(value: unknown) {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return "{}";
    }
  }
}
