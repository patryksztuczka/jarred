import { Command } from "commander";
import inquirer from "inquirer";

type RunStatus = "queued" | "processing" | "completed" | "failed";

interface ChatMessageAcceptedResponse {
  ok: true;
  status: "accepted";
  runId: string;
  threadId: string;
  messageId: string;
  model: string;
}

interface CliConfig {
  baseUrl: string;
  model?: string;
  timeoutMs: number;
  threadId?: string;
}

interface CommandOptions {
  baseUrl: string;
  model?: string;
  timeoutMs: string;
  threadId?: string;
}

const DEFAULT_BASE_URL = "http://localhost:3000";
const DEFAULT_TIMEOUT_MS = 30_000;

const config = parseArgs(process.argv);

const run = async () => {
  let activeThreadId = config.threadId;

  console.log("Agent chat smoke CLI");
  console.log(`Server: ${config.baseUrl}`);
  console.log(`Model: ${config.model ?? "(server default)"}`);
  console.log("Type a message and press Enter. Type /exit to quit.");

  while (true) {
    const promptPrefix = activeThreadId ? `[${activeThreadId}]` : "[new thread]";
    const promptAnswer = await inquirer.prompt<{ message: string }>([
      {
        type: "input",
        name: "message",
        message: `${promptPrefix} You:`,
      },
    ]);
    const message = promptAnswer.message.trim();

    if (!message) {
      continue;
    }

    if (message === "/exit" || message === "/quit") {
      break;
    }

    const accepted = await sendMessage({
      baseUrl: config.baseUrl,
      content: message,
      model: config.model,
      threadId: activeThreadId,
    });

    activeThreadId = accepted.threadId;

    console.log(`Run accepted: ${accepted.runId}`);
    let hasPrintedAgentLabel = false;

    const streamStatus = await waitForRunWebSocket({
      baseUrl: config.baseUrl,
      runId: accepted.runId,
      timeoutMs: config.timeoutMs,
      onToken: (delta) => {
        if (!hasPrintedAgentLabel) {
          process.stdout.write("Agent: ");
          hasPrintedAgentLabel = true;
        }
        process.stdout.write(delta);
      },
    });

    if (streamStatus.status === "failed") {
      console.log(`Agent run failed: ${streamStatus.safeError ?? "Unknown error"}`);
      continue;
    }
...
    console.log(`Agent: ${streamStatus.reply}`);
  }
};

function parseArgs(argv: string[]): CliConfig {
  const program = new Command();

  program
    .name("chat-smoke")
    .description("Interactive CLI to test sending and receiving agent messages")
    .option("-u, --base-url <url>", "API base URL", DEFAULT_BASE_URL)
    .option("-m, --model <model>", "Model id used for /api/chat/messages")
    .option("--thread-id <id>", "Continue an existing thread")
    .option("--timeout-ms <number>", "Max wait for run completion", `${DEFAULT_TIMEOUT_MS}`)
    .parse(argv);

  const options = program.opts<CommandOptions>();

  return {
    baseUrl: options.baseUrl.replace(/\/+$/, ""),
    model: options.model,
    timeoutMs: toPositiveNumber(options.timeoutMs, DEFAULT_TIMEOUT_MS),
    threadId: options.threadId,
  };
}

function toPositiveNumber(value: string, fallback: number) {
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

const sendMessage = async (inputData: {
  baseUrl: string;
  content: string;
  model?: string;
  threadId?: string;
}) => {
  const response = await fetch(`${inputData.baseUrl}/api/chat/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      content: inputData.content,
      model: inputData.model,
      threadId: inputData.threadId,
    }),
  });

  if (!response.ok) {
    const errorPayload = await response.text();
    throw new Error(`Failed to send message (${response.status}): ${errorPayload}`);
  }

  const payload = (await response.json()) as Partial<ChatMessageAcceptedResponse>;
  if (!payload.runId || !payload.threadId) {
    throw new Error("Invalid /api/chat/messages response shape");
  }

  return payload as ChatMessageAcceptedResponse;
};

const waitForRunWebSocket = async (inputData: {
  baseUrl: string;
  runId: string;
  timeoutMs: number;
  onToken?: (delta: string) => void;
}) => {
  const wsUrl = toWebSocketUrl(`${inputData.baseUrl}/ws/runs/${inputData.runId}`);

  return await new Promise<{
    status: RunStatus;
    safeError?: string;
    reply?: string;
    streamedReply: string;
    didStreamTokens: boolean;
  }>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let hasSettled = false;
    let finalStatus: RunStatus = "processing";
    let safeError: string | undefined;
    let reply: string | undefined;
    let streamedReply = "";
    let didStreamTokens = false;

    const settleResolve = () => {
      if (hasSettled) {
        return;
      }

      hasSettled = true;
      clearTimeout(timeoutId);
      resolve({
        status: finalStatus,
        safeError,
        reply,
        streamedReply,
        didStreamTokens,
      });
    };

    const settleReject = (error: Error) => {
      if (hasSettled) {
        return;
      }

      hasSettled = true;
      clearTimeout(timeoutId);
      reject(error);
    };

    const timeoutId = setTimeout(() => {
      ws.close(1000, "timeout");
      settleReject(new Error(`Run did not finish within ${inputData.timeoutMs}ms`));
    }, inputData.timeoutMs);

    ws.addEventListener("message", (event) => {
      try {
        const raw = typeof event.data === "string" ? event.data : String(event.data);
        const payload = JSON.parse(raw) as { type?: string; payload?: unknown };

        if (!payload.type) {
          return;
        }

        switch (payload.type) {
          case "agent.token": {
            const tokenPayload = payload.payload as { delta?: unknown };
            if (typeof tokenPayload.delta === "string" && tokenPayload.delta.length > 0) {
              streamedReply += tokenPayload.delta;
              didStreamTokens = true;
              inputData.onToken?.(tokenPayload.delta);
            }
            break;
          }
          case "agent.message": {
            const messagePayload = payload.payload as { message?: unknown };
            if (typeof messagePayload.message === "string") {
              reply = messagePayload.message;
            }
            break;
          }
          case "tool.started": {
            const toolPayload = payload.payload as { toolName?: unknown };
            if (typeof toolPayload.toolName === "string" && toolPayload.toolName.length > 0) {
              process.stdout.write(`\n[tool] ${formatToolName(toolPayload.toolName)}\n`);
            }
            break;
          }
          case "run.failed": {
            const failedPayload = payload.payload as { error?: unknown };
            finalStatus = "failed";
            safeError = typeof failedPayload.error === "string" ? failedPayload.error : undefined;
            ws.close(1000, "run failed");
            break;
          }
          case "run.completed": {
            finalStatus = "completed";
            ws.close(1000, "run completed");
            break;
          }
          case "connection.ready":
          case "run.started": {
            break;
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        settleReject(new Error(`Failed to parse WebSocket message: ${message}`));
        ws.close(1011, "parse failure");
      }
    });

    ws.addEventListener("close", () => {
      settleResolve();
    });

    ws.addEventListener("error", () => {
      settleReject(new Error("WebSocket connection failed"));
    });
  });
};

const toWebSocketUrl = (url: string) => {
  const parsed = new URL(url);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  return parsed.toString();
};

const formatToolName = (toolName: string) => {
  return toolName
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll(/[_-]+/g, " ")
    .trim()
    .replaceAll(/\s+/g, " ")
    .replaceAll(/\b\w/g, (character) => {
      return character.toUpperCase();
    });
};

await run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`chat-smoke failed: ${message}`);
  process.exitCode = 1;
});
