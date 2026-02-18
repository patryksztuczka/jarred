import { describe, expect, test } from "bun:test";
import Redis from "ioredis";
import { EVENT_TYPE, type AgentEvent } from "../../src/events/types";
import { RedisStreamBus } from "../../src/events/redis-stream";
import { AgentRuntime } from "../../src/runtime/agent-runtime";
import { createInMemoryRunLoopEventService } from "../../src/services/chat/loop-event-service";

const runRedisTests = process.env.RUN_REDIS_TESTS === "true";
const describeIfRedis = runRedisTests ? describe : describe.skip;

describeIfRedis("Redis Streams integration", () => {
  test("publishes request event and runtime emits completed event", async () => {
    const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
    const redis = new Redis(redisUrl);
    try {
      const streamKey = `agent_events_test_${crypto.randomUUID()}`;
      const groupName = `group_${crypto.randomUUID()}`;
      const consumerName = "worker_1";

      const bus = new RedisStreamBus(redis, { streamKey });
      const runtime = new AgentRuntime({
        bus,
        runLoopEventService: createInMemoryRunLoopEventService(),
        consumerGroup: groupName,
        consumerName,
        logger: { info: () => {}, error: () => {} },
      });

      await runtime.init();

      const requestEvent: AgentEvent<typeof EVENT_TYPE.AGENT_RUN_REQUESTED> = {
        id: "evt_requested_1",
        type: EVENT_TYPE.AGENT_RUN_REQUESTED,
        timestamp: "2026-01-01T00:00:00.000Z",
        correlationId: "corr_int_1",
        payload: {
          runId: "run_abcdefghijklmnopqrstuvwx",
          threadId: "thr_abcdefghijklmnopqrstuvwx",
          prompt: "process me",
          model: "gpt-4o-mini",
        },
      };

      await bus.publish(requestEvent);
      const processed = await runtime.processOnce();

      expect(processed).toBe(1);

      const streamRecords = await redis.xrange(streamKey, "-", "+");
      const events: AgentEvent[] = [];
      for (const record of streamRecords) {
        const fields = record[1];
        for (let index = 0; index < fields.length; index += 2) {
          const value = fields[index + 1];
          if (fields[index] === "event" && typeof value === "string") {
            events.push(JSON.parse(value) as AgentEvent);
          }
        }
      }

      expect(events).toHaveLength(2);
      expect(events[0]?.type).toBe(EVENT_TYPE.AGENT_RUN_REQUESTED);
      expect(events[1]?.type).toBe(EVENT_TYPE.AGENT_RUN_COMPLETED);
      expect(typeof events[1]?.id).toBe("string");
      expect(events[1]?.id.length).toBeGreaterThan(0);
      expect(typeof events[1]?.timestamp).toBe("string");
      expect(Number.isNaN(Date.parse(events[1]?.timestamp ?? ""))).toBe(false);
      expect(events[1]?.correlationId).toBe("corr_int_1");
      expect(events[1]?.payload).toEqual({
        requestEventId: "evt_requested_1",
        output: "Handled prompt: process me",
      });

      await redis.del(streamKey);
    } finally {
      await redis.quit();
    }
  });
});
