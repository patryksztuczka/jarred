export const EVENT_BUS_EVENT_TYPE = {
  RUN_STARTED: "run.started",
  TOOL_STARTED: "tool.started",
  AGENT_TOKEN: "agent.token",
  AGENT_MESSAGE: "agent.message",
  RUN_COMPLETED: "run.completed",
  RUN_FAILED: "run.failed",
} as const;

interface RunStartedEvent {
  type: typeof EVENT_BUS_EVENT_TYPE.RUN_STARTED;
  payload: {
    runId: string;
    threadId: string;
    model: string;
  };
}

interface AgentTokenEvent {
  type: typeof EVENT_BUS_EVENT_TYPE.AGENT_TOKEN;
  payload: {
    runId: string;
    threadId: string;
    iteration: number;
    delta: string;
  };
}

interface ToolStartedEvent {
  type: typeof EVENT_BUS_EVENT_TYPE.TOOL_STARTED;
  payload: {
    runId: string;
    threadId: string;
    iteration: number;
    toolName: string;
  };
}

interface AgentMessageEvent {
  type: typeof EVENT_BUS_EVENT_TYPE.AGENT_MESSAGE;
  payload: {
    runId: string;
    threadId: string;
    message: string;
  };
}

interface RunCompletedEvent {
  type: typeof EVENT_BUS_EVENT_TYPE.RUN_COMPLETED;
  payload: {
    runId: string;
    threadId: string;
  };
}

interface RunFailedEvent {
  type: typeof EVENT_BUS_EVENT_TYPE.RUN_FAILED;
  payload: {
    runId: string;
    threadId: string;
    error: string;
  };
}

export type EventBusEvent =
  | RunStartedEvent
  | ToolStartedEvent
  | AgentTokenEvent
  | AgentMessageEvent
  | RunCompletedEvent
  | RunFailedEvent;

type EventBusListener = (event: EventBusEvent) => void;

export interface EventBus {
  subscribe(runId: string, listener: EventBusListener): () => void;
  publish(event: EventBusEvent): void;
}

export class InMemoryEventBus implements EventBus {
  private readonly listenersByRunId = new Map<string, Set<EventBusListener>>();

  public subscribe(runId: string, listener: EventBusListener) {
    const listeners = this.listenersByRunId.get(runId) ?? new Set<EventBusListener>();
    listeners.add(listener);
    this.listenersByRunId.set(runId, listeners);

    return () => {
      const currentListeners = this.listenersByRunId.get(runId);
      if (!currentListeners) {
        return;
      }

      currentListeners.delete(listener);
      if (currentListeners.size === 0) {
        this.listenersByRunId.delete(runId);
      }
    };
  }

  public publish(event: EventBusEvent) {
    const listeners = this.listenersByRunId.get(event.payload.runId);
    if (!listeners || listeners.size === 0) {
      return;
    }

    for (const listener of listeners) {
      listener(event);
    }
  }
}
