# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is an agentic feedback review service. It receives webhooks from a Next.js/Vercel app when users submit or upvote feature requests, then uses the Anthropic API (claude-opus-4-5 with tool use) to analyze the feedback, explore a target GitHub codebase via the GitHub API, and open draft pull requests automatically.

## Running

```bash
node server.js        # starts Express on PORT (default 3001)
```

No build step. No test suite yet. ES modules throughout (`"type": "module"` in package.json).

## Architecture

Three files, each with a single responsibility:

- **server.js** — Express server. Defines webhook endpoints and gating logic. Responds to webhooks immediately, then runs the agent async. Tracks submission IDs in two in-memory Sets (`processedIds`, `inProgressIds`) to prevent duplicate runs. A failed run is removed from `inProgressIds` but not added to `processedIds`, allowing retry on the next webhook.
- **agent.js** — Agentic loop. `runAgent(submission)` sends messages to Claude in a loop: on `tool_use` stop reason, executes all tool blocks and feeds results back; on `end_turn`, returns the final text. `markSubmissionComplete(submissionId, prUrl)` is a single-turn variant for post-merge cleanup.
- **tools.js** — Tool definitions and execution. Exports `toolDefinitions` (Anthropic tool schema array) and `executeTool(toolName, toolInput)`. Tools fall into two categories:
  - **GitHub tools** (via Octokit): `list_directory`, `read_file`, `search_files`, `create_pull_request` — these operate on the repo specified by `GITHUB_OWNER`/`GITHUB_REPO` env vars.
  - **App callback tools** (via fetch to `APP_API_URL`): `post_comment`, `update_status` — these call back into the Next.js app using `APP_API_SECRET` bearer auth.

All tools return strings and never throw; errors are caught and returned as descriptive strings.

## Endpoints

| Route | Auth | Purpose |
|---|---|---|
| `POST /webhook/feedback` | `x-webhook-secret` header | Main webhook from the Next.js app |
| `POST /webhook/pr-merged` | `secret` field in body | Triggers completion comment + status update |
| `POST /test` | None | Local testing — pass a submission object directly |
| `GET /health` | None | Returns status, threshold, and queue counts |

## Key Conventions

- Webhook handlers respond with `{ received: true }` before doing async work — never block the webhook response on agent execution.
- The agent's system prompt defines strict guardrails: auto-implement only small/safe changes (<=3 files for bug fixes, <=5 files total), decline auth/payment/DB/security changes.
- Submission status lifecycle: `open` → `under_review` → `in_progress` → `completed` or `declined`.
- `create_pull_request` always creates draft PRs and appends a line linking back to the feedback submission ID.

## Environment Variables

All configured via `.env` (loaded by `dotenv/config` at the top of server.js):

- `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO` — core service credentials
- `AGENT_WEBHOOK_SECRET` — shared secret for webhook validation
- `APP_API_URL` — base URL of the Next.js app API (e.g. `https://myapp.vercel.app/api`)
- `APP_API_SECRET` — bearer token for agent → app callbacks
- `VOTE_THRESHOLD` — minimum upvotes before agent acts (default 1)
- `PORT` — server port (default 3001)
