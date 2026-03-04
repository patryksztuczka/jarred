# server

To install dependencies:

```bash
bun install
```

To run in watch mode:

```bash
bun run dev
```

The server expects Redis for event streaming. Start Redis first:

```bash
bun run redis:up
```

Stop Redis when done:

```bash
bun run redis:down
```

To run tests:

```bash
bun run test
```

To run Redis integration tests (requires Redis running):

```bash
RUN_REDIS_TESTS=true bun run test
```

To run tests in watch mode:

```bash
bun run test:watch
```

To lint:

```bash
bun run lint
```

To auto-fix lint issues:

```bash
bun run lint:fix
```

To type-check:

```bash
bun run check-types
```

To format:

```bash
bun run format:write
```

To verify formatting:

```bash
bun run format
```

## Event-driven runtime

`POST /api/chat/messages` persists an incoming user chat message, then publishes `agent.run.requested`.

For chat ingress, `threadId` is optional. If omitted, the API generates a safe Cuid2-based id in
the form `thr_<24 lowercase alphanumerics>` and returns it in the response.
The runtime consumes those events and emits either:

- `agent.run.completed`
- `agent.run.failed`

Chat ingress example:

```bash
curl -X POST http://localhost:3000/api/chat/messages \
  -H "content-type: application/json" \
  -d '{"content":"Summarize current state", "model":"gpt-4o-mini"}'
```

`model` is optional. If omitted, the server uses `CHAT_DEFAULT_MODEL`.

Quick CLI smoke tester (interactive):

```bash
bun run chat:cli -- --base-url http://localhost:3000
```

Optional flags:

- `--model <model-id>`
- `--thread-id <thr_...>` to continue an existing thread
- `--timeout-ms <number>`

The CLI opens a WebSocket stream at `GET /api/chat/runs/:runId/ws` and prints live run updates.

Environment variable template: `.env.example`.

Optional environment variables:

- `REDIS_URL` (default `redis://localhost:6379`)
- `REDIS_STREAM_KEY` (default `agent_events`)
- `REDIS_CONSUMER_GROUP` (default `agent_runtime`)
- `REDIS_CONSUMER_NAME` (default `worker-<pid>`)
- `OPENAI_API_KEY` (required for real LLM responses)
- `CHAT_ALLOWED_MODELS` (optional comma-separated allow list; when empty, any model id is allowed)
- `CHAT_SUMMARY_MODEL` (optional model for summary memory generation)
- `CHAT_MEMORY_RECENT_MESSAGES` (count of recent messages kept verbatim; default `8`)
- `AGENT_MAX_LOOP_ITERATIONS` (maximum iterations per run; default `1`)

## Database (Drizzle ORM + SQLite)

This project is configured with Drizzle ORM and Drizzle Kit.

By default, the SQLite database file is local:

```bash
file:./db/sqlite.db
```

You can override this with `DATABASE_URL`.

Generate migrations from schema changes:

```bash
bun run db:generate
```

Apply migrations:

```bash
bun run db:migrate
```

Open Drizzle Studio:

```bash
bun run db:studio
```

Check migration drift:

```bash
bun run db:check
```

This project was created using `bun init` in bun v1.3.3. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
