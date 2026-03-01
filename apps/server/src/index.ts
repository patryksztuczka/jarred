import Redis from "ioredis";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";

import { createApp } from "./app";
import { createDrizzleChatIngressService } from "./services/chat/ingress-service";
import { createDrizzleChatMessageService } from "./services/chat/message-service";
import { createDrizzleChatRunService } from "./services/chat/run-service";
import { createDrizzleRunLoopEventService } from "./services/chat/loop-event-service";
import { createAiSdkChatLlmService } from "./services/chat/llm-service";
import { OutboxPublisher } from "./events/outbox-publisher";
import { createDrizzleOutboxService } from "./services/events/outbox-service";
import { createOutboxPubSub } from "./services/events/outbox-pubsub";
import { RedisStreamBus } from "./events/redis-stream";
import { AgentRuntime } from "./agent/runtime";
import { createChatRunPubSub } from "./services/chat/run-pubsub";
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
const bus = new RedisStreamBus(redis, {
  streamKey: redisStreamKey,
});
const runPubsub = createChatRunPubSub();
const outboxPubsub = createOutboxPubSub();
const llmService = createAiSdkChatLlmService();
const messageService = createDrizzleChatMessageService(db);
const runService = createDrizzleChatRunService(db, runPubsub);
const runLoopEventService = createDrizzleRunLoopEventService(db, runPubsub);
const ingressService = createDrizzleChatIngressService(db, outboxPubsub);
const outboxService = createDrizzleOutboxService(db, outboxPubsub);
const outboxPublisher = new OutboxPublisher({
  outboxService,
  publisher: bus,
  pubsub: outboxPubsub,
});

const runtime = new AgentRuntime({
  bus,
  messageService,
  runService,
  llmService,
  runLoopEventService,
  consumerGroup: redisConsumerGroup,
  consumerName: redisConsumerName,
  model: "gpt-5-nano",
  recentMessageCount: 10,
  maxIterations: 5,
});

await runtime.init();
runtime.start();
outboxPublisher.start();

const app = createApp({
  ingressService,
  messageService,
  runService,
  runLoopEventService,
  pubsub: runPubsub,
});

const server = Bun.serve({
  port,
  fetch: app.fetch,
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
  outboxPublisher.stop();

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
