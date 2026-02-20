import "dotenv/config";
import express from "express";
import { runAgent, markSubmissionComplete } from "./agent.js";

const app = express();
app.use(express.json());

console.log(`[startup] Node ${process.version}, pid ${process.pid}`);
console.log(`[startup] ENV: PORT=${process.env.PORT}, VOTE_THRESHOLD=${process.env.VOTE_THRESHOLD}`);

const PORT = process.env.PORT || 3000;
const VOTE_THRESHOLD = parseInt(process.env.VOTE_THRESHOLD || "1", 10);
const WEBHOOK_SECRET = process.env.AGENT_WEBHOOK_SECRET;

const processedIds = new Set();
const inProgressIds = new Set();

// --- Webhook: feedback submitted or upvoted ---
app.post("/webhook/feedback", (req, res) => {
  const secret = req.headers["x-webhook-secret"];
  if (secret !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: "Invalid webhook secret" });
  }

  // Respond immediately
  res.json({ received: true });

  const submission = req.body;
  console.log(
    `\n📩 Webhook received: "${submission.title}" (${submission.upvotes} upvotes)`
  );

  // Gate: vote threshold
  if ((submission.upvotes || 0) < VOTE_THRESHOLD) {
    console.log(
      `  ⏭️  Skipped: upvotes (${submission.upvotes}) below threshold (${VOTE_THRESHOLD})`
    );
    return;
  }

  // Gate: already processed or in progress
  if (processedIds.has(submission.id)) {
    console.log(`  ⏭️  Skipped: submission ${submission.id} already processed`);
    return;
  }
  if (inProgressIds.has(submission.id)) {
    console.log(
      `  ⏭️  Skipped: submission ${submission.id} already in progress`
    );
    return;
  }

  // Run the agent asynchronously
  inProgressIds.add(submission.id);
  runAgent(submission)
    .then(() => {
      inProgressIds.delete(submission.id);
      processedIds.add(submission.id);
      console.log(`  ✅ Agent completed for submission ${submission.id}`);
    })
    .catch((err) => {
      inProgressIds.delete(submission.id);
      console.error(
        `  ❌ Agent failed for submission ${submission.id}:`,
        err.message
      );
    });
});

// --- Webhook: PR merged ---
app.post("/webhook/pr-merged", (req, res) => {
  const { secret, submission_id, pr_url } = req.body;
  if (secret !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: "Invalid webhook secret" });
  }

  res.json({ received: true });

  console.log(
    `\n🔀 PR merged webhook received for submission ${submission_id}`
  );

  markSubmissionComplete(submission_id, pr_url).catch((err) => {
    console.error(
      `  ❌ Failed to mark submission ${submission_id} complete:`,
      err.message
    );
  });
});

// --- Test endpoint (no auth) ---
app.post("/test", (req, res) => {
  const submission = req.body;
  res.json({ received: true, message: "Agent started for test submission" });

  console.log(`\n🧪 Test run for: "${submission.title}"`);

  runAgent(submission)
    .then(() => console.log(`  ✅ Test agent run completed`))
    .catch((err) => console.error(`  ❌ Test agent run failed:`, err.message));
});

// --- Health check ---
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    vote_threshold: VOTE_THRESHOLD,
    processed_count: processedIds.size,
    in_progress_count: inProgressIds.size,
  });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Feedback Agent server running on port ${PORT}`);
  console.log(`   Vote threshold: ${VOTE_THRESHOLD}`);
  console.log(`   Make sure ngrok is running if you need external webhooks!\n`);
});

server.on('error', (err) => {
  console.error(`[server] Error: ${err.message}`);
});

server.on('close', () => {
  console.log('[server] Server closed');
});

process.on('SIGTERM', () => {
  console.log('[process] Received SIGTERM');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('[process] Received SIGINT');
  server.close(() => process.exit(0));
});

process.on('uncaughtException', (err) => {
  console.error('[process] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[process] Unhandled rejection:', reason);
});
