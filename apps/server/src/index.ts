import Redis from "ioredis";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";

import { createApp, websocket } from "./app";
import { DrizzleMessageService } from "./modules/messages/messages-service";
import { DrizzleRunService } from "./modules/runs/runs-service";
import { AiSdkLlmService } from "./modules/llm/llm-service";
import { RedisStreamBus } from "./event-bus/redis-stream";
import { AgentRuntime } from "./agent/runtime";
import { db } from "../db";

const port = Number(process.env.PORT ?? 3000);
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const redisStreamKey = process.env.REDIS_STREAM_KEY ?? "agent_events";
const redisConsumerGroup = process.env.REDIS_CONSUMER_GROUP ?? "agent_runtime";
const redisConsumerName = process.env.REDIS_CONSUMER_NAME ?? `worker-${process.pid}`;

const sdk = new NodeSDK({
  spanProcessors: [new LangfuseSpanProcessor()],
});

sdk.start();

const redis = new Redis(redisUrl);
const eventBus = new RedisStreamBus(redis, {
  streamKey: redisStreamKey,
});
const llmService = new AiSdkLlmService();
const messageService = DrizzleMessageService.fromDatabase(db);
const runService = DrizzleRunService.fromDatabase(db);

const runtime = new AgentRuntime({
  eventBus,
  messageService,
  runService,
  llmService,
  consumerGroup: redisConsumerGroup,
  consumerName: redisConsumerName,
  model: "gpt-5-nano",
  recentMessageCount: 10,
  maxIterations: 5,
});

await runtime.init();
runtime.start();

const app = createApp({
  messageService,
  eventBus,
  runService,
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

  runtime.stop();

  try {
    server.stop(true);
  } catch {
    // no-op
  }

  try {
    redis.disconnect();
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
