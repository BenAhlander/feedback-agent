# Feedback Agent API Reference

Base URL: `http://localhost:{PORT}` (default `3000`)

---

## `POST /webhook/feedback`

Main webhook called by the FreshTomatoes app when a submission is created or upvoted. Triggers the agent to review and potentially implement the feedback.

**Authentication:** `x-webhook-secret` header must match the `AGENT_WEBHOOK_SECRET` env var.

**Request body:**

```json
{
  "id": "uuid",
  "title": "string",
  "description": "string",
  "category": "bug | feature | general",
  "upvotes": 5
}
```

**Behavior:**

1. Responds immediately with `{ "received": true }` before processing.
2. Skips the submission silently if:
   - `upvotes` is below `VOTE_THRESHOLD` (default `1`)
   - The submission ID has already been processed
   - The submission ID is currently in progress
3. Runs the agent asynchronously. On success the submission ID is added to `processedIds` to prevent re-processing. On failure it is removed from `inProgressIds`, allowing retry on the next webhook.

**Response:**

```json
{ "received": true }
```

**Errors:**

| Status | Body | Cause |
|--------|------|-------|
| `401` | `{ "error": "Invalid webhook secret" }` | Missing or incorrect `x-webhook-secret` header |

---

## `POST /webhook/new-feedback`

Called when a new feedback post is created. The agent reads the post and leaves a short, friendly reply as a film-loving community manager — thanking the user and engaging with their feedback. Does not change the submission status.

**Authentication:** `x-webhook-secret` header must match the `AGENT_WEBHOOK_SECRET` env var.

**Request body:**

```json
{
  "submission_id": "uuid"
}
```

**Behavior:**

1. Responds immediately with `{ "received": true }`.
2. Runs `reviewSubmission` asynchronously — fetches the submission, then posts a warm, short comment (2-4 sentences) that references the user's specific feedback and connects it to the movie-loving experience.

**Response:**

```json
{ "received": true }
```

**Errors:**

| Status | Body | Cause |
|--------|------|-------|
| `401` | `{ "error": "Invalid webhook secret" }` | Missing or incorrect `x-webhook-secret` header |

---

## `POST /webhook/pr-merged`

Called when a draft PR created by the agent has been merged. Triggers a completion comment and status update on the original submission.

**Authentication:** `secret` field in the request body must match `AGENT_WEBHOOK_SECRET`.

**Request body:**

```json
{
  "secret": "string",
  "submission_id": "string",
  "pr_url": "https://github.com/owner/repo/pull/123"
}
```

**Behavior:**

1. Responds immediately with `{ "received": true }`.
2. Runs `markSubmissionComplete` asynchronously, which uses a lightweight model to post a friendly user-facing comment and set the submission status to `completed`.

**Response:**

```json
{ "received": true }
```

**Errors:**

| Status | Body | Cause |
|--------|------|-------|
| `401` | `{ "error": "Invalid webhook secret" }` | Missing or incorrect `secret` in body |

---

## `POST /test`

Local testing endpoint. Accepts a submission object and runs the full agent loop without authentication or deduplication checks.

**Authentication:** None.

**Request body:**

```json
{
  "id": "test-123",
  "title": "string",
  "description": "string",
  "category": "bug | feature | general",
  "upvotes": 5
}
```

**Behavior:**

1. Responds immediately with a confirmation message.
2. Runs the agent asynchronously. No vote threshold gating, no duplicate checking.

**Response:**

```json
{
  "received": true,
  "message": "Agent started for test submission"
}
```

---

## `GET /health`

Health check endpoint for uptime monitoring and observability.

**Authentication:** None.

**Response:**

```json
{
  "status": "ok",
  "vote_threshold": 1,
  "processed_count": 12,
  "in_progress_count": 1
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Always `"ok"` |
| `vote_threshold` | number | Current `VOTE_THRESHOLD` setting |
| `processed_count` | number | Number of submission IDs in the completed set (capped at 1000) |
| `in_progress_count` | number | Number of submissions currently being processed by the agent |
