import { useEffect, useRef, useState } from "react";

type UserMessage = {
  role: "user";
  content: string;
};

type AgentTextMessage = {
  role: "agent";
  type: "text";
  content: string;
  reasoning?: string;
  isStreaming?: boolean;
  isReasoningStreaming?: boolean;
};

type AgentToolCallMessage = {
  role: "agent";
  type: "tool_call";
  toolName: string;
  args: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
};

type Message = UserMessage | AgentTextMessage | AgentToolCallMessage;

type SessionModelMessage = {
  role: string;
  content: unknown;
};

type SessionResponse = {
  messages: SessionModelMessage[];
};

function ToolCallBlock({ message }: { message: AgentToolCallMessage }) {
  return (
    <CollapsibleBlock
      label={
        <span className="flex items-center gap-1.5">
          <span className="flex h-4 w-4 items-center justify-center rounded bg-amber-100 dark:bg-amber-900/50">
            <ToolIcon />
          </span>
          <span className="tracking-wide">
            Tool: <span className="font-mono">{message.toolName}</span>
          </span>
          {message.status === "approved" && (
            <span className="ml-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
              Approved
            </span>
          )}
          {message.status === "rejected" && (
            <span className="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700 dark:bg-red-900/40 dark:text-red-400">
              Rejected
            </span>
          )}
        </span>
      }
      content={JSON.stringify(message.args, null, 2)}
    />
  );
}

function ToolIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform duration-200 ${open ? "rotate-90" : "rotate-0"}`}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function CollapsibleBlock({
  label,
  content,
  isStreaming,
  defaultCollapsed = true,
}: {
  label: React.ReactNode;
  content: string;
  isStreaming?: boolean;
  defaultCollapsed?: boolean;
}) {
  const [expanded, setExpanded] = useState(!defaultCollapsed);
  const contentRef = useRef<HTMLDivElement>(null);

  // Auto-collapse when streaming finishes
  useEffect(() => {
    if (!isStreaming && content) {
      setExpanded(false);
    }
  }, [isStreaming]);

  return (
    <div className="ml-9.5 max-w-[80%]">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800/50 hover:text-zinc-300"
      >
        <ChevronIcon open={expanded} />
        {label}
        {isStreaming && (
          <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" />
        )}
      </button>
      <div
        className="overflow-hidden transition-all duration-200 ease-out"
        style={{
          maxHeight: expanded ? `${contentRef.current?.scrollHeight ?? 2000}px` : "0px",
          opacity: expanded ? 1 : 0,
        }}
      >
        <div
          ref={contentRef}
          className="mt-1 ml-2 border-l-2 border-zinc-700/50 pl-3 text-xs leading-relaxed whitespace-pre-wrap text-zinc-500 dark:text-zinc-400"
        >
          {content}
        </div>
      </div>
    </div>
  );
}

function ThinkingBlock({ reasoning, isStreaming }: { reasoning: string; isStreaming?: boolean }) {
  return (
    <CollapsibleBlock
      label={<span className="tracking-wide">Thinking</span>}
      content={reasoning}
      isStreaming={isStreaming}
    />
  );
}

function AgentAvatar() {
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700 dark:bg-violet-900/50 dark:text-violet-400">
      A
    </div>
  );
}

function SkeletonBubble() {
  return (
    <div className="flex items-start gap-2.5">
      <AgentAvatar />
      <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-zinc-100 px-4 py-3 dark:bg-zinc-800">
        <div className="flex gap-1">
          <div className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:0ms]" />
          <div className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:150ms]" />
          <div className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}

const API_URL = "http://localhost:3001";
const REASONING_EFFORTS = ["minimal", "low", "medium", "high"] as const;

type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getTextFromContentPart(part: unknown) {
  if (!isRecord(part) || typeof part.type !== "string") {
    return undefined;
  }

  if ((part.type === "text" || part.type === "reasoning") && typeof part.text === "string") {
    return part.text;
  }

  return undefined;
}

function sessionMessagesToUiMessages(messages: SessionModelMessage[]): Message[] {
  const uiMessages: Message[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      if (typeof message.content === "string") {
        uiMessages.push({ role: "user", content: message.content });
        continue;
      }

      if (Array.isArray(message.content)) {
        const content = message.content
          .map((part) => getTextFromContentPart(part))
          .filter((value): value is string => Boolean(value))
          .join("");

        if (content) {
          uiMessages.push({ role: "user", content });
        }
      }

      continue;
    }

    if (message.role === "assistant") {
      if (typeof message.content === "string") {
        uiMessages.push({ role: "agent", type: "text", content: message.content });
        continue;
      }

      if (!Array.isArray(message.content)) {
        continue;
      }

      let content = "";
      let reasoning = "";

      const toolCalls: AgentToolCallMessage[] = [];

      for (const part of message.content) {
        if (!isRecord(part) || typeof part.type !== "string") {
          continue;
        }

        if (part.type === "reasoning" && typeof part.text === "string") {
          reasoning += part.text;
        }

        if (part.type === "text" && typeof part.text === "string") {
          content += part.text;
        }

        if (part.type === "tool-call" && typeof part.toolName === "string") {
          toolCalls.push({
            role: "agent",
            type: "tool_call",
            toolName: part.toolName,
            args: isRecord(part.args) ? part.args : {},
            status: "approved",
          });
        }
      }

      if (content || reasoning) {
        uiMessages.push({
          role: "agent",
          type: "text",
          content,
          reasoning: reasoning || undefined,
        });
      }

      uiMessages.push(...toolCalls);
    }
  }

  return uiMessages;
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [reasoningEnabled, setReasoningEnabled] = useState(true);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("medium");
  const [showSkeleton, setShowSkeleton] = useState(false);
  const streamingContentRef = useRef("");
  const streamingReasoningRef = useRef("");

  useEffect(() => {
    let isCancelled = false;

    async function loadSession() {
      try {
        const res = await fetch(`${API_URL}/session`);
        if (!res.ok) {
          return;
        }

        const data = (await res.json()) as SessionResponse;
        if (isCancelled) {
          return;
        }

        setMessages(sessionMessagesToUiMessages(data.messages ?? []));
      } catch (err) {
        console.error("Failed to load session:", err);
      }
    }

    void loadSession();

    return () => {
      isCancelled = true;
    };
  }, []);

  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    const userMessage: UserMessage = { role: "user", content: trimmed };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsStreaming(true);
    setShowSkeleton(true);
    streamingContentRef.current = "";
    streamingReasoningRef.current = "";

    try {
      const res = await fetch(`${API_URL}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          reasoningEnabled,
          reasoningEffort: reasoningEnabled ? reasoningEffort : undefined,
        }),
      });

      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice("data:".length).trim();
          if (!data) continue;

          try {
            const event = JSON.parse(data);
            handleSSEEvent(event);
          } catch {
            // ignore malformed events
          }
        }
      }
    } catch (err) {
      console.error("Failed to send message:", err);
    } finally {
      setIsStreaming(false);
      setShowSkeleton(false);
    }
  }

  function handleSSEEvent(event: { type: string; [key: string]: unknown }) {
    switch (event.type) {
      case "agent.reasoning.start": {
        if (showSkeleton) setShowSkeleton(false);

        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "agent" && last.type === "text" && last.isStreaming) {
            return [...prev.slice(0, -1), { ...last, isReasoningStreaming: true }];
          }

          return [
            ...prev,
            { role: "agent", type: "text", content: "", reasoning: "", isStreaming: true, isReasoningStreaming: true },
          ];
        });
        break;
      }
      case "agent.reasoning.delta": {
        const delta = event.delta as string;
        streamingReasoningRef.current += delta;
        const reasoning = streamingReasoningRef.current;

        if (showSkeleton) setShowSkeleton(false);

        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "agent" && last.type === "text" && last.isStreaming) {
            return [...prev.slice(0, -1), { ...last, reasoning, isReasoningStreaming: true }];
          }

          return [
            ...prev,
            { role: "agent", type: "text", content: "", reasoning, isStreaming: true, isReasoningStreaming: true },
          ];
        });
        break;
      }
      case "agent.reasoning.end": {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "agent" && last.type === "text" && last.isStreaming) {
            return [...prev.slice(0, -1), { ...last, isReasoningStreaming: false }];
          }
          return prev;
        });
        break;
      }
      case "agent.token": {
        const delta = event.delta as string;
        streamingContentRef.current += delta;
        const content = streamingContentRef.current;

        if (showSkeleton) setShowSkeleton(false);

        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "agent" && last.type === "text" && last.isStreaming) {
            return [
              ...prev.slice(0, -1),
              { ...last, content, reasoning: streamingReasoningRef.current },
            ];
          }
          return [
            ...prev,
            {
              role: "agent",
              type: "text",
              content,
              reasoning: streamingReasoningRef.current,
              isStreaming: true,
            },
          ];
        });
        break;
      }
      case "tool.start": {
        const toolName = event.toolName as string;
        const args = (event.args as Record<string, unknown>) ?? {};

        if (showSkeleton) setShowSkeleton(false);

        setMessages((prev) => [
          ...prev,
          { role: "agent", type: "tool_call", toolName, args, status: "pending" as const },
        ]);
        break;
      }
      case "tool.end": {
        setMessages((prev) => {
          const lastToolIdx = prev.findLastIndex(
            (msg) => msg.role === "agent" && msg.type === "tool_call" && msg.status === "pending",
          );
          if (lastToolIdx === -1) return prev;
          return prev.map((msg, i) =>
            i === lastToolIdx && msg.role === "agent" && msg.type === "tool_call"
              ? { ...msg, status: "approved" as const }
              : msg,
          );
        });
        break;
      }
      case "agent.end": {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.role === "agent" && msg.type === "text" && msg.isStreaming
              ? { ...msg, isStreaming: false }
              : msg,
          ),
        );
        streamingContentRef.current = "";
        streamingReasoningRef.current = "";
        break;
      }
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }


  return (
    <div className="flex h-screen flex-col bg-white dark:bg-zinc-900">
      {/* Header */}
      <header className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
        <div className="h-2 w-2 rounded-full bg-emerald-500" />
        <h1 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Agent Chat</h1>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {messages.map((msg, i) => {
            if (msg.role === "user") {
              return (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-br-md bg-violet-600 px-4 py-2.5 text-sm text-white">
                    {msg.content}
                  </div>
                </div>
              );
            }

            if (msg.type === "text") {
              return (
                <div key={i} className="flex flex-col gap-2">
                  {msg.reasoning ? (
                    <ThinkingBlock reasoning={msg.reasoning} isStreaming={msg.isReasoningStreaming} />
                  ) : null}
                  {msg.content ? (
                    <div className="flex items-start gap-2.5">
                      <AgentAvatar />
                      <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-zinc-100 px-4 py-2.5 text-sm whitespace-pre-wrap text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
                        {msg.content}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            }

            return (
              <div key={i}>
                <ToolCallBlock message={msg} />
              </div>
            );
          })}
          {showSkeleton && <SkeletonBubble />}
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-700">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3 px-1 py-1">
            <button
              onClick={() => !isStreaming && setReasoningEnabled((v) => !v)}
              disabled={isStreaming}
              className={`flex cursor-pointer items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                reasoningEnabled
                  ? "bg-violet-600/15 text-violet-400 ring-1 ring-violet-500/30"
                  : "bg-zinc-800 text-zinc-400 ring-1 ring-zinc-700"
              }`}
            >
              <span
                className={`flex h-3.5 w-3.5 items-center justify-center rounded transition-colors ${
                  reasoningEnabled ? "bg-violet-500" : "bg-zinc-600"
                }`}
              >
                {reasoningEnabled && (
                  <svg
                    width="8"
                    height="8"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="white"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </span>
              Reasoning
            </button>
            {reasoningEnabled && (
              <div className="flex items-center gap-1 rounded-full bg-zinc-800 p-0.5 ring-1 ring-zinc-700">
                {REASONING_EFFORTS.map((effort) => (
                  <button
                    key={effort}
                    onClick={() => setReasoningEffort(effort)}
                    disabled={isStreaming}
                    className={`cursor-pointer rounded-full px-2.5 py-1 text-xs font-medium capitalize transition-all disabled:cursor-not-allowed ${
                      reasoningEffort === effort
                        ? "bg-violet-600 text-white shadow-sm"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {effort}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Type a message..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
            />
            <button
              onClick={handleSend}
              disabled={isStreaming || !input.trim()}
              className="cursor-pointer rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
