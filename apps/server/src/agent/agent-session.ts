import type { ToolSet } from "ai";

import type { MessageService } from "../modules/messages/messages-schemas";
import type { RunService } from "../modules/runs/runs-schemas";
import { RUN_STREAM_EVENT_TYPE, type RunStreamService } from "./run-stream-service";
import type { LangfusePromptService } from "../modules/llm/langfuse-service";
import { Agent } from "./agent";
import type { AgentEvent } from "./agent-event";
import {
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_MODEL,
  DEFAULT_RECENT_MESSAGES_COUNT,
} from "../lib/constants";

export interface AgentSessionOptions {
  messageService: MessageService;
  runService: RunService;
  runStreamService: RunStreamService;
  langfuseService: LangfusePromptService;
  tools: ToolSet;
  defaultModel?: string;
  recentMessageCount?: number;
}

export class AgentSession {
  private readonly messageService: MessageService;
  private readonly runService: RunService;
  private readonly runStreamService: RunStreamService;
  private readonly langfuseService: LangfusePromptService;
  private readonly tools: ToolSet;
  private readonly defaultModel: string;
  private readonly recentMessageCount: number;

  constructor(options: AgentSessionOptions) {
    this.messageService = options.messageService;
    this.runService = options.runService;
    this.runStreamService = options.runStreamService;
    this.langfuseService = options.langfuseService;
    this.tools = options.tools;
    this.defaultModel = options.defaultModel ?? DEFAULT_MODEL;
    this.recentMessageCount = options.recentMessageCount ?? DEFAULT_RECENT_MESSAGES_COUNT;
  }

  async start(input: { runId: string; threadId: string; model?: string }) {
    const { runId, threadId } = input;
    const model = input.model ?? this.defaultModel;

    try {
      await this.runService.updateRunStatus({ runId, status: "processing" });
      this.runStreamService.publish({
        type: RUN_STREAM_EVENT_TYPE.RUN_STARTED,
        payload: { runId, threadId, model },
      });

      const messages = await this.messageService.listMessagesByThreadId(
        threadId,
        this.recentMessageCount,
      );
      const systemPrompt = await this.langfuseService.getSystemPrompt();

      const agent = new Agent({
        systemPrompt: systemPrompt ?? "",
        model,
        tools: this.tools,
        maxIterations: DEFAULT_MAX_ITERATIONS,
      });

      agent.subscribe((event: AgentEvent) => {
        this.handleAgentEvent(event, runId, threadId);
      });

      const result = await agent.run(messages);

      if (result.reason === "error") {
        await this.runService.updateRunStatus({ runId, status: "failed", error: result.error });
        this.runStreamService.publish({
          type: RUN_STREAM_EVENT_TYPE.RUN_FAILED,
          payload: { runId, threadId, error: result.error ?? "unknown" },
        });
      } else {
        await this.runService.updateRunStatus({ runId, status: "completed" });
        this.runStreamService.publish({
          type: RUN_STREAM_EVENT_TYPE.RUN_COMPLETED,
          payload: { runId, threadId },
        });
      }
    } catch (error) {
      const safeError = error instanceof Error ? error.message : "unknown";
      await this.runService.updateRunStatus({ runId, status: "failed", error: safeError });
      this.runStreamService.publish({
        type: RUN_STREAM_EVENT_TYPE.RUN_FAILED,
        payload: { runId, threadId, error: safeError },
      });
    }
  }

  private handleAgentEvent(event: AgentEvent, runId: string, threadId: string) {
    switch (event.type) {
      case "agent.token": {
        this.runStreamService.publish({
          type: RUN_STREAM_EVENT_TYPE.ASSISTANT_TOKEN,
          payload: { runId, threadId, iteration: event.iteration, delta: event.delta },
        });
        break;
      }
      case "tool.start": {
        this.runStreamService.publish({
          type: RUN_STREAM_EVENT_TYPE.TOOL_STARTED,
          payload: { runId, threadId, iteration: event.iteration, toolName: event.toolName },
        });
        break;
      }
      case "message.complete": {
        const content = getPersistedMessageContent(event.message);
        void this.messageService.createAssistantMessage({ threadId, content });

        if (event.message.role === "assistant") {
          this.runStreamService.publish({
            type: RUN_STREAM_EVENT_TYPE.ASSISTANT_MESSAGE,
            payload: { runId, threadId, message: content },
          });
        }
        break;
      }
    }
  }
}

function getPersistedMessageContent(message: { role: string; content: unknown }): string {
  if (message.role === "assistant") {
    return getAssistantMessageText(message.content);
  }

  if (!Array.isArray(message.content)) {
    return "No content";
  }

  const toolCalls = message.content
    .flatMap((part: { type?: string; toolName?: string; output?: unknown }) => {
      if (part.type !== "tool-result") {
        return [];
      }

      const payload = getToolPayload(part.output);

      return [
        {
          toolName: part.toolName ?? "unknown",
          args: payload?.args ?? null,
          output: payload?.output ?? part.output,
        },
      ];
    })
    .filter((entry: { toolName: string }) => entry.toolName.length > 0);

  return JSON.stringify(toolCalls);
}

function getAssistantMessageText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "No content";
  }

  const textContent = content
    .flatMap((part: { type?: string; text?: string }) =>
      part.type === "text" ? [part.text ?? ""] : [],
    )
    .join("\n")
    .trim();

  return textContent.length > 0 ? textContent : "No content";
}

function getToolPayload(output: unknown): { args: unknown; output: unknown } | undefined {
  if (!output || typeof output !== "object") {
    return undefined;
  }

  const record = output as Record<string, unknown>;
  if (record.type !== "text" || typeof record.value !== "string") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(record.value) as Record<string, unknown>;
    if (typeof parsed !== "object" || parsed === null) {
      return undefined;
    }
    return { args: parsed.args, output: parsed.output };
  } catch {
    return undefined;
  }
}
