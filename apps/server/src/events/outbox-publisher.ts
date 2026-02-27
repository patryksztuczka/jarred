import type { EventPublisher } from "./types";
import type { OutboxService } from "../services/events/outbox-service";
import type { OutboxPubSub } from "../services/events/outbox-pubsub";

interface OutboxPublisherOptions {
  outboxService: OutboxService;
  publisher: EventPublisher;
  pubsub: OutboxPubSub;
  batchSize?: number;
  logger?: Pick<Console, "info" | "error">;
  pollIntervalMs?: number;
}

export class OutboxPublisher {
  private readonly outboxService: OutboxService;
  private readonly publisher: EventPublisher;
  private readonly pubsub: OutboxPubSub;
  private readonly batchSize: number;
  private readonly logger: Pick<Console, "info" | "error">;
  private readonly pollIntervalMs: number;
  private isRunning = false;
  private isProcessing = false;
  private shouldProcessAgain = false;
  private unsubscribe?: () => void;
  private pollTimer?: ReturnType<typeof setInterval>;

  public constructor(options: OutboxPublisherOptions) {
    this.outboxService = options.outboxService;
    this.publisher = options.publisher;
    this.pubsub = options.pubsub;
    this.batchSize = options.batchSize ?? 10;
    this.logger = options.logger ?? console;
    this.pollIntervalMs = options.pollIntervalMs ?? 10_000; // Default 10 seconds
  }

  public start() {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    // Listen for new events
    this.unsubscribe = this.pubsub.subscribe(() => {
      this.triggerProcessing();
    });

    // Start background poll to catch any missed/failed events
    this.pollTimer = setInterval(() => {
      if (this.isRunning) {
        this.triggerProcessing();
      }
    }, this.pollIntervalMs);
  }

  public stop() {
    this.isRunning = false;

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private triggerProcessing() {
    if (!this.isRunning) {
      return;
    }

    if (this.isProcessing) {
      this.shouldProcessAgain = true;
      return;
    }

    void this.processQueue();
  }

  private async processQueue() {
    this.isProcessing = true;
    this.shouldProcessAgain = false;

    try {
      const processed = await this.processOnce();
      if (processed === this.batchSize) {
        // If we processed a full batch, there might be more events waiting
        this.shouldProcessAgain = true;
      }
    } catch (error) {
      this.logger.error("outbox.process.error", {
        error: error instanceof Error ? error.message : "unknown",
      });
    } finally {
      this.isProcessing = false;

      if (this.shouldProcessAgain && this.isRunning) {
        this.triggerProcessing();
      }
    }
  }

  public async processOnce() {
    const events = await this.outboxService.listRetryableEvents(this.batchSize);
    if (events.length === 0) {
      return 0;
    }

    for (const outboxEvent of events) {
      try {
        await this.publisher.publish(outboxEvent.event);
        await this.outboxService.markPublished(outboxEvent.id);

        this.logger.info("outbox.publish.success", {
          eventId: outboxEvent.id,
        });
      } catch (error) {
        const safeMessage = error instanceof Error ? error.message : "unknown";
        await this.outboxService.markPublishFailed(outboxEvent.id, safeMessage);

        this.logger.error("outbox.publish.failed", {
          eventId: outboxEvent.id,
          error: safeMessage,
        });
      }
    }

    return events.length;
  }
}
