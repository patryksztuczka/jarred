import { useRef, useState } from "react";

type UserMessage = {
  role: "user";
  content: string;
};

type AgentTextMessage = {
  role: "agent";
  type: "text";
  content: string;
  isStreaming?: boolean;
};

type AgentToolCallMessage = {
  role: "agent";
  type: "tool_call";
  toolName: string;
  args: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
};

type Message = UserMessage | AgentTextMessage | AgentToolCallMessage;

function ToolCallBubble({
  message,
  onApprove,
  onReject,
}: {
  message: AgentToolCallMessage;
  onApprove?: () => void;
  onReject?: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/50">
      <div className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
        <span className="flex h-5 w-5 items-center justify-center rounded bg-amber-100 text-xs dark:bg-amber-900/50">
          <ToolIcon />
        </span>
        <span className="font-mono text-xs">{message.toolName}</span>
        {message.status === "approved" && (
          <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
            Approved
          </span>
        )}
        {message.status === "rejected" && (
          <span className="ml-auto rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900/40 dark:text-red-400">
            Rejected
          </span>
        )}
      </div>
      <pre className="overflow-x-auto rounded bg-zinc-100 p-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
        {JSON.stringify(message.args, null, 2)}
      </pre>
      {message.status === "pending" && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={onApprove}
            className="cursor-pointer rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
          >
            Approve
          </button>
          <button
            onClick={onReject}
            className="cursor-pointer rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-600"
          >
            Reject
          </button>
        </div>
      )}
    </div>
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

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const streamingContentRef = useRef("");

  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    const userMessage: UserMessage = { role: "user", content: trimmed };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsStreaming(true);
    setShowSkeleton(true);
    streamingContentRef.current = "";

    try {
      const res = await fetch(`${API_URL}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
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
      case "agent.token": {
        const delta = event.delta as string;
        streamingContentRef.current += delta;
        const content = streamingContentRef.current;

        if (showSkeleton) setShowSkeleton(false);

        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (
            last?.role === "agent" &&
            last.type === "text" &&
            last.isStreaming
          ) {
            return [
              ...prev.slice(0, -1),
              { ...last, content },
            ];
          }
          return [
            ...prev,
            { role: "agent", type: "text", content, isStreaming: true },
          ];
        });
        break;
      }
      case "session.complete":
      case "session.error": {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.role === "agent" && msg.type === "text" && msg.isStreaming
              ? { ...msg, isStreaming: false }
              : msg
          )
        );
        streamingContentRef.current = "";
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

  function handleApprove(index: number) {
    setMessages((prev) =>
      prev.map((msg, i) =>
        i === index && msg.role === "agent" && msg.type === "tool_call"
          ? { ...msg, status: "approved" as const }
          : msg
      )
    );
  }

  function handleReject(index: number) {
    setMessages((prev) =>
      prev.map((msg, i) =>
        i === index && msg.role === "agent" && msg.type === "tool_call"
          ? { ...msg, status: "rejected" as const }
          : msg
      )
    );
  }

  return (
    <div className="flex h-screen flex-col bg-white dark:bg-zinc-900">
      {/* Header */}
      <header className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
        <div className="h-2 w-2 rounded-full bg-emerald-500" />
        <h1 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          Agent Chat
        </h1>
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
                <div key={i} className="flex items-start gap-2.5">
                  <AgentAvatar />
                  <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-zinc-100 px-4 py-2.5 text-sm whitespace-pre-wrap text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
                    {msg.content}
                  </div>
                </div>
              );
            }

            return (
              <div key={i} className="flex items-start gap-2.5">
                <AgentAvatar />
                <div className="max-w-[80%]">
                  <ToolCallBubble
                    message={msg}
                    onApprove={() => handleApprove(i)}
                    onReject={() => handleReject(i)}
                  />
                </div>
              </div>
            );
          })}
          {showSkeleton && <SkeletonBubble />}
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-700">
        <div className="mx-auto flex max-w-2xl gap-2">
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
  );
}
