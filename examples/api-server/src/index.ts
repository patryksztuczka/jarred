import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { AgentSession } from "@jarred/agent-session";
import { webfetch } from "@jarred/agent-core";

const app = new Hono();

app.use("/*", cors());

app.post("/message", async (c) => {
  const { message } = await c.req.json<{ message: string }>();

  return streamSSE(c, async (stream) => {
    const session = new AgentSession({
      tools: { webfetch },
      systemPrompt: `
      You are a helpful assistant.

      Action selection policy:
        - You must set action to exactly one of: continue, finish.
        - Use continue only when another internal iteration is needed to complete the task.
        - Use finish when your response is complete and ready for the user.
        - If you need clarification from the user, set action to finish and include the clarification question(s) in response.
        - If information is missing or ambiguous, set action to finish and ask concise, specific follow-up question(s) in response.
      `,
    });

    let id = 0;

    const done = new Promise<void>((resolve) => {
      session.subscribe((event) => {
        const streamedTypes = [
          "session.start",
          "session.complete",
          "session.error",
          "agent.token",
          "message.complete",
        ];

        if (!streamedTypes.includes(event.type)) return;

        stream
          .writeSSE({
            id: String(id++),
            event: event.type,
            data: JSON.stringify(event),
          })
          .catch(console.error);

        if (
          event.type === "session.complete" ||
          event.type === "session.error"
        ) {
          resolve();
        }
      });
    });

    const runId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();

    void session.prompt(message, { runId, sessionId });

    await done;
  });
});

serve({ fetch: app.fetch, port: 3001 }, (info) => {
  console.log(`Server running on http://localhost:${info.port}`);
});
