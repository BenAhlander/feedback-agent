# Feedback Agent

An agentic service that automatically reviews user feedback, explores your GitHub codebase, and opens draft pull requests — powered by Claude.

## How It Works

1. Users submit feature requests or bug reports in your Next.js app
2. When a submission hits the upvote threshold, the app sends a webhook to this service
3. The agent (Claude with tool use) reads the submission, explores your repo via the GitHub API, posts a public comment with its assessment, and opens a draft PR if the change is safe and well-scoped
4. When the PR is merged, a second webhook triggers a completion comment back on the original submission

## Setup

### Prerequisites

- Node.js 18+
- A GitHub personal access token with `repo` scope
- An Anthropic API key
- A Next.js app configured to send webhooks to this service

### Install

```bash
npm install
```

### Configure

Copy the example below into a `.env` file:

```env
ANTHROPIC_API_KEY=sk-ant-...
GITHUB_TOKEN=ghp_...
GITHUB_OWNER=your-username
GITHUB_REPO=your-repo
AGENT_WEBHOOK_SECRET=your-shared-secret
APP_API_URL=https://myapp.vercel.app/api
APP_API_SECRET=your-app-secret
VOTE_THRESHOLD=1
PORT=3000
```

### Run

```bash
node server.js
```

For external webhooks from a deployed Next.js app, expose the server with ngrok:

```bash
ngrok http 3000
```

## API Endpoints

### `POST /webhook/feedback`

Main webhook endpoint. Validates the `x-webhook-secret` header, then runs the agent if the submission meets the vote threshold and hasn't already been processed.

**Request body:** A submission object with `id`, `title`, `description`, `category`, and `upvotes`.

### `POST /webhook/pr-merged`

Called when a draft PR created by the agent gets merged. The agent posts a completion comment and marks the submission as completed.

**Request body:** `{ "secret": "...", "submission_id": "...", "pr_url": "..." }`

### `POST /test`

No auth required. Pass a submission object directly to trigger the agent — useful for local development.

```bash
curl -X POST http://localhost:3000/test \
  -H "Content-Type: application/json" \
  -d '{"id": "1", "title": "Change button color to blue", "description": "The submit button should be blue instead of gray", "upvotes": 5}'
```

### `GET /health`

Returns server status, current vote threshold, and queue counts.

## Agent Guardrails

The agent will auto-implement:
- Small UI changes (colors, spacing, text, layout tweaks)
- Simple feature toggles or boolean flags
- Copy/text updates
- Isolated bug fixes touching 3 or fewer files

The agent will decline:
- Authentication or authorization changes
- Payment or billing logic
- Database schema changes or migrations
- Changes touching more than 5 files
- Security-sensitive code
- Changes requiring new dependencies

## Architecture

| File | Role |
|---|---|
| `server.js` | Express server with webhook endpoints and deduplication logic |
| `agent.js` | Agentic loop — sends messages to Claude, processes tool calls, returns final response |
| `tools.js` | Tool definitions (Anthropic schema) and execution — GitHub operations via Octokit, app callbacks via fetch |
