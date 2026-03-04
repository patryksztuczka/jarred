import { LangfuseClient } from "@langfuse/client";

const LANGFUSE_PROMPT_NAME = "jarred-system-prompt";
const LANGFUSE_PROMPT_LABEL = "production";
const SYSTEM_PROMPT_CACHE_TTL_SECONDS = 60;

const getCurrentDateString = () => new Date().toISOString().slice(0, 10);

export interface LangfusePromptService {
  getSystemPrompt(): Promise<string | undefined>;
}

export class LangfuseService implements LangfusePromptService {
  private readonly client: LangfuseClient;

  constructor() {
    this.client = new LangfuseClient();
  }

  async getSystemPrompt() {
    try {
      const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
      const secretKey = process.env.LANGFUSE_SECRET_KEY;

      if (!publicKey || !secretKey) {
        return undefined;
      }

      const prompt = await this.client.prompt.get(LANGFUSE_PROMPT_NAME, {
        type: "text",
        label: LANGFUSE_PROMPT_LABEL,
        cacheTtlSeconds: SYSTEM_PROMPT_CACHE_TTL_SECONDS,
      });

      return prompt.compile({
        date: getCurrentDateString(),
      });
    } catch (error) {
      const safeError = error instanceof Error ? error.message : "unknown";
      console.error(`Failed to fetch system prompt from Langfuse: ${safeError}`);

      return undefined;
    }
  }
}
