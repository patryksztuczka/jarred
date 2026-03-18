import { openai } from "@ai-sdk/openai";
import {
  Output,
  streamText,
  type AssistantModelMessage,
  type ModelMessage,
  type ToolModelMessage,
} from "ai";

import { type LangfusePromptService, LangfuseService } from "./langfuse-service";
import {
  type GenerateAssistantResponseInput,
  assistantLlmOutputSchema,
  type LlmService,
} from "./llm-schemas";
import { webfetch } from "../../agent/tools/webfetch";
import { readWorkingMemory, updateWorkingMemory } from "../../agent/tools/memory/memory-tools";

export class AiSdkLlmService implements LlmService {
  private readonly tools = {
    webfetch,
    readWorkingMemory,
    updateWorkingMemory,
  };

  constructor(private readonly langfuseService: LangfusePromptService = new LangfuseService()) {}

  async generateAssistantResponse(input: GenerateAssistantResponseInput) {
    const messages = await this.buildPromptMessages(input.messages);
    const reportedToolCallIds = new Set<string>();

    const result = streamText({
      model: openai(input.model),
      messages,
      output: Output.object({ schema: assistantLlmOutputSchema }),
      tools: this.tools,
      experimental_telemetry: { isEnabled: true },
      onChunk: async ({ chunk }) => {
        if (chunk.type !== "tool-call") {
          return;
        }

        if (reportedToolCallIds.has(chunk.toolCallId)) {
          return;
        }

        reportedToolCallIds.add(chunk.toolCallId);
        await input.onToolCall?.(chunk.toolName);
      },
    });

    let streamedResponse = "";
    for await (const partialOutput of result.partialOutputStream) {
      const partialResponse = this.getPartialResponseText(partialOutput);
      if (!partialResponse || partialResponse.length <= streamedResponse.length) {
        continue;
      }

      const delta = partialResponse.slice(streamedResponse.length);
      streamedResponse = partialResponse;
      await input.onTextDelta?.(delta);
    }

    const toolResults = await result.toolResults;
    const toolResult = toolResults.at(0);
    if (toolResult) {
      return this.buildToolActionResponse(toolResult);
    }

    const output = await result.output;

    return this.buildAssistantActionResponse(output.action, output.response);
  }

  private getPartialResponseText(partialOutput: unknown) {
    if (!partialOutput || typeof partialOutput !== "object") {
      return;
    }

    const response = (partialOutput as { response?: unknown }).response;
    if (typeof response !== "string") {
      return;
    }

    return response;
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
