import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";

import { createApp, websocket } from "./app";
import { DrizzleMessageService } from "./modules/messages/messages-service";
import { DrizzleRunService } from "./modules/runs/runs-service";
import { InMemoryRunStreamService } from "./agent/run-stream-service";
import { LangfuseService } from "./modules/llm/langfuse-service";
import { webfetch } from "./agent/tools/webfetch";
import { readWorkingMemory, updateWorkingMemory } from "./agent/tools/memory/memory-tools";
import { db } from "../db";

const port = Number(process.env.PORT ?? 3000);

const sdk = new NodeSDK({
  spanProcessors: [new LangfuseSpanProcessor()],
});

sdk.start();

const messageService = DrizzleMessageService.fromDatabase(db);
const runService = DrizzleRunService.fromDatabase(db);
const runStreamService = new InMemoryRunStreamService();
const langfuseService = new LangfuseService();

const app = createApp({
  messageService,
  runService,
  runStreamService,
  langfuseService,
  tools: { webfetch, readWorkingMemory, updateWorkingMemory },
  defaultModel: "gpt-5-nano",
  recentMessageCount: 10,
});

const server = Bun.serve({
  port,
  fetch: app.fetch,
  websocket,
});

console.log(`Server listening on http://localhost:${port}`);

let isShuttingDown = false;

const shutdown = async (signal: NodeJS.Signals) => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`Received ${signal}, shutting down...`);

  try {
    server.stop(true);
  } catch {
    // no-op
  }

  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
