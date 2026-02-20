# FreshTomatoes API Reference

Base URL: `/api`

---

## TMDB Data Routes

### `GET /api/theater`

Fetches the top 20 now-playing movies enriched with revenue, budget, and runtime data.

**Response:** `MovieListItem[]`

Falls back to mock data when `TMDB_API_KEY` is not set (demo mode). Enrichment is batched at 5 concurrent requests to avoid rate limits.

---

### `GET /api/streaming`

Fetches trending movies and TV shows combined, sorted by popularity.

| Param    | Type   | Default | Description                  |
| -------- | ------ | ------- | ---------------------------- |
| `window` | string | `week`  | Trending window: `week` or `day` |

**Response:** `StreamingListItem[]` (unified format with `media_type` field)

---

### `GET /api/movie/[id]`

Fetches full movie details including credits and watch provider info (parallel fetch).

| Param | Type   | Required | Description |
| ----- | ------ | -------- | ----------- |
| `id`  | string | yes      | TMDB movie ID (path param) |

**Response:** `MovieDetail` object, or `null` if TMDB API is not configured.

---

### `GET /api/search`

Proxies search queries to TMDB.

| Param  | Type   | Default | Description                        |
| ------ | ------ | ------- | ---------------------------------- |
| `q`    | string | —       | Search query (required, non-empty) |
| `type` | string | `movie` | `movie` or `multi` (movies + TV)   |

**Response:** TMDB search results array.

**Errors:**
- `400` — Missing or empty `q` parameter

---

## Feedback Routes

### `GET /api/feedback`

Lists feedback posts with sorting, filtering, and pagination (20 per page).

| Param      | Type   | Default | Description                                |
| ---------- | ------ | ------- | ------------------------------------------ |
| `sort`     | string | `hot`   | `hot`, `new`, or `top`                     |
| `category` | string | `all`   | `all`, `bug`, `feature`, or `general`      |
| `page`     | number | `1`     | Page number (1-indexed)                    |
| `voterId`  | string | —       | Anonymous voter ID to track user's votes   |

**Sort algorithms:**
- `new` — Most recent first (`created_at DESC`)
- `top` — Highest score first (`score DESC`)
- `hot` — Trending: `(score + 1) / sqrt(hours_old)`

**Response:**
```json
{
  "posts": [{
    "id": "uuid",
    "title": "string",
    "body": "string",
    "category": "bug | feature | general",
    "score": 5,
    "status": "open",
    "author_id": "string",
    "created_at": "ISO 8601",
    "comment_count": 3,
    "userVote": -1 | 0 | 1,
    "isOwner": true | false
  }],
  "hasMore": true | false
}
```

---

### `POST /api/feedback`

Creates a new feedback post. Requires Auth0 authentication.

**Request body:**
```json
{
  "title": "string (3-100 chars)",
  "body": "string (10-500 chars)",
  "category": "bug | feature | general"
}
```

HTML tags are stripped from `title` and `body` for XSS prevention.

**Response:** The created `FeedbackPost` with `score: 0` and `userVote: 0`.

On success, fires a webhook to `AGENT_SERVICE_URL/webhook/new-feedback` (via `waitUntil()`) with `{ submission_id }` so the agent can review and leave a comment.

**Errors:**
- `401` — Not authenticated
- `400` — Validation failure (title/body length, invalid category)

---

### `DELETE /api/feedback/[id]`

Deletes a feedback post. Requires Auth0 authentication. Authors can only delete their own posts.

| Param | Type   | Required | Description          |
| ----- | ------ | -------- | -------------------- |
| `id`  | string | yes      | Post ID (path param) |

**Errors:**
- `401` — Not authenticated
- `403` — Not the post author
- `404` — Post not found

---

### `POST /api/feedback/[id]/vote`

Casts, changes, or removes a vote on a post. Uses SHA256-hashed voter IDs for anonymous tracking.

| Param | Type   | Required | Description          |
| ----- | ------ | -------- | -------------------- |
| `id`  | string | yes      | Post ID (path param) |

**Request body:**
```json
{
  "voterId": "string",
  "action": "up | down | remove"
}
```

Idempotent — voting the same direction twice returns the current score without creating duplicates.

**Response:**
```json
{
  "score": 5
}
```

---

## Agent/Submissions Routes

These routes are for internal agent consumption and require agent authentication via `validateAgentRequest()`.

### `GET /api/submissions`

Lists feedback posts for agent processing.

| Param         | Type   | Default | Description                           |
| ------------- | ------ | ------- | ------------------------------------- |
| `status`      | string | —       | Filter by status                      |
| `min_upvotes` | number | —       | Minimum score threshold               |
| `limit`       | number | `50`    | Results per page (1-200)              |

**Response:** Raw `feedback_posts` rows.

**Errors:**
- `401` — Invalid agent credentials

---

### `GET /api/submissions/[id]`

Fetches a single post with all its comments.

**Response:**
```json
{
  "submission": { /* post data */ },
  "comments": [{ /* ordered by created_at ASC */ }]
}
```

---

### `PATCH /api/submissions/[id]/status`

Updates a post's status (agent-only).

**Request body:**
```json
{
  "status": "open | under_review | in_progress | completed | declined"
}
```

**Response:** The updated post object.

---

### `GET /api/submissions/[id]/comments`

Fetches all comments for a post (no auth required).

**Response:** Comments array ordered by `created_at ASC`.

---

### `POST /api/submissions/[id]/comments`

Creates a comment on a post. Agent requests can set `is_agent_comment: true` and optionally update the post status.

**Request body (user):**
```json
{
  "author_id": "string",
  "body": "string (1-2000 chars)"
}
```

**Request body (agent):**
```json
{
  "body": "string (1-2000 chars)",
  "status": "open | under_review | in_progress | completed | declined"
}
```

HTML tags are stripped from `body`. If an agent provides `status`, the post status is updated atomically.

---

### `DELETE /api/submissions/[id]/comments/[commentId]`

Deletes a comment. Authors can only delete their own.

| Param       | Type   | Required | Description               |
| ----------- | ------ | -------- | ------------------------- |
| `author_id` | string | yes      | Query param for ownership |

**Errors:**
- `403` — Not the comment author

---

## Database Migration

### `POST /api/migrate`

Runs idempotent schema migrations. Protected by a shared secret.

| Param    | Type   | Required | Description                              |
| -------- | ------ | -------- | ---------------------------------------- |
| `secret` | string | yes      | Must match `MIGRATION_SECRET` env var    |

Adds the `status` column to `feedback_posts` and creates the `feedback_comments` table with indexes.

**Errors:**
- `401` — Missing or invalid secret
