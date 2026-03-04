import type Redis from "ioredis";
import type { RunEvent } from "./types";

export interface StreamEntry {
  streamEntryId: string;
  event: RunEvent;
}

interface RedisStreamBusOptions {
  streamKey: string;
}

export interface EventBus {
  publish(event: RunEvent): Promise<void>;
  ensureConsumerGroup(groupName: string): Promise<void>;
  readGroup(
    groupName: string,
    consumerName: string,
    options?: { blockMs?: number; count?: number },
  ): Promise<StreamEntry[]>;
  acknowledge(groupName: string, streamEntryId: string): Promise<void>;
}

export class RedisStreamBus implements EventBus {
  private readonly redis: Redis;
  private readonly streamKey: string;

  public constructor(redis: Redis, options: RedisStreamBusOptions) {
    this.redis = redis;
    this.streamKey = options.streamKey;
  }

  public async publish(event: RunEvent) {
    await this.redis.xadd(this.streamKey, "*", "event", JSON.stringify(event));
  }

  public async ensureConsumerGroup(groupName: string) {
    try {
      await this.redis.xgroup("CREATE", this.streamKey, groupName, "$", "MKSTREAM");
    } catch (error) {
      if (error instanceof Error && error.message.includes("BUSYGROUP")) {
        return;
      }

      throw error;
    }
  }

  public async readGroup(
    groupName: string,
    consumerName: string,
    options: { blockMs?: number; count?: number } = {},
  ) {
    const blockMs = options.blockMs ?? 250;
    const count = options.count ?? 1;

    const response = await this.redis.xreadgroup(
      "GROUP",
      groupName,
      consumerName,
      "COUNT",
      String(count),
      "BLOCK",
      String(blockMs),
      "STREAMS",
      this.streamKey,
      ">",
    );

    if (!response) {
      return [];
    }

    return parseStreamResponse(response);
  }

  public async acknowledge(groupName: string, streamEntryId: string) {
    await this.redis.xack(this.streamKey, groupName, streamEntryId);
  }

  public getKey() {
    return this.streamKey;
  }
}

const parseStreamResponse = (raw: unknown) => {
  if (!Array.isArray(raw)) {
    return [];
  }

  const entries: StreamEntry[] = [];

  for (const streamChunk of raw) {
    if (!Array.isArray(streamChunk) || streamChunk.length < 2) {
      continue;
    }

    const chunkEntries = streamChunk[1];
    if (!Array.isArray(chunkEntries)) {
      continue;
    }

    for (const chunkEntry of chunkEntries) {
      if (!Array.isArray(chunkEntry) || chunkEntry.length < 2) {
        continue;
      }

      const streamEntryId = chunkEntry[0];
      const fields = chunkEntry[1];

      if (typeof streamEntryId !== "string" || !Array.isArray(fields)) {
        continue;
      }

      const eventValue = extractField(fields, "event");
      if (typeof eventValue !== "string") {
        continue;
      }

      const parsedEvent = safeParseEvent(eventValue);
      if (!parsedEvent) {
        continue;
      }

      entries.push({
        streamEntryId,
        event: parsedEvent,
      });
    }
  }

  return entries;
};

const extractField = (fields: unknown[], targetKey: string) => {
  for (let index = 0; index < fields.length; index += 2) {
    const key = fields[index];
    const value = fields[index + 1];

    if (key === targetKey) {
      return value;
    }
  }

  return;
};

const safeParseEvent = (value: string) => {
  try {
    return JSON.parse(value) as RunEvent;
  } catch {
    return;
  }
};
