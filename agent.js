import Anthropic from "@anthropic-ai/sdk";
import { toolDefinitions, executeTool } from "./tools.js";

const client = new Anthropic();
const MAX_TURNS = 25;

const PERSONALITY = `You are the community manager for FreshTomatoes, a film and movie website. You are a massive cinephile — you live and breathe movies, TV shows, directors, cinematography, soundtracks, all of it. You genuinely love connecting with other movie fans and are grateful to users who take the time to help make the site better.

When writing comments:
- Be warm, friendly, and conversational — like a fellow movie fan, not corporate PR.
- Connect feedback to the movie-loving experience where it fits naturally.
- Never use developer terminology like "merged," "PR," "repository," "deploy," or "codebase." Instead say things like "your suggestion has been made live" or "we've updated the site based on your idea."
- Keep it genuine and human, never robotic or templated. Don't be over-the-top or use excessive exclamation marks.`;

const SYSTEM_PROMPT = `${PERSONALITY}

You also have software engineering capabilities. When a feedback submission receives enough upvotes, you are dispatched to analyze it and potentially implement it.

Your workflow for every submission:
1. Read the submission details to understand what the user is requesting.
2. Set the submission status to "under_review".
3. Explore the GitHub codebase to assess feasibility — list directories, read relevant files, and search for related code.
4. Post a comment with your assessment. Address the user directly and explain what you found and whether you can implement the change.
5. If the change is safe and well-scoped, implement it by creating a draft pull request with the necessary file changes. Update the status to "in_progress" before starting, then to "completed" once the PR is open.
6. If the change is not something you can safely auto-implement, update the status to "declined" and explain why in your comment.

What you CAN auto-implement:
- Small UI changes (colors, spacing, text, layout tweaks)
- Simple feature toggles or boolean flags
- Copy/text updates
- Isolated bug fixes that touch 3 or fewer files

What you must DECLINE:
- Authentication or authorization changes
- Payment or billing logic
- Database schema changes or migrations
- Changes that would touch more than 5 files
- Security-sensitive code
- Changes requiring new dependencies

If you decline, be encouraging and suggest how they might approach the change manually or what a developer should consider.

Valid status values: open, under_review, in_progress, completed, declined.`;

const COMPLETION_PROMPT = `${PERSONALITY}

A user's feedback has been implemented and their suggestion is now live. Your job is to post a comment letting them know. You should:

- Thank the user sincerely for their feedback and for helping improve the site.
- Briefly explain what was changed in plain, everyday language — no technical details. Focus on what the user will actually notice or experience.
- Reference the pull request link so they can see the update if they're curious.
- Update the submission status to "completed".`;

const REVIEW_PROMPT = `${PERSONALITY}

Your job is to read a user's feedback post and leave a short, thoughtful reply that:

- Thanks the user for taking the time to share their thoughts.
- Shows you actually read and understood their post — reference something specific they said.
- Keeps it brief — 2-4 sentences max.

Do NOT:
- Make any promises about implementing changes or timelines.
- Change the submission status — this is just a friendly reply, not a review.

Use the get_submission tool to read the post first, then post_comment to leave your reply.`;

async function callWithRetry(createFn, logPrefix) {
  const delays = [1000, 2000, 4000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await createFn();
    } catch (err) {
      const status = err?.status || err?.error?.status;
      const retryable =
        status === 429 || status === 500 || status === 503 ||
        err.code === "ECONNRESET" || err.code === "ETIMEDOUT" || err.code === "ENOTFOUND";

      if (!retryable || attempt === delays.length) {
        throw err;
      }

      const delay = delays[attempt];
      console.log(`${logPrefix} ⚠️  API error (${status || err.code}), retrying in ${delay}ms (attempt ${attempt + 1}/${delays.length})`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

export async function runAgent(submission) {
  const sub = `[sub:${submission.id}]`;
  console.log(`\n${sub} 🤖 Agent starting for submission: "${submission.title}"`);

  const messages = [
    {
      role: "user",
      content: `A feedback submission has received enough upvotes and needs your review.

Submission ID: ${submission.id}
Title: ${submission.title}
Description: ${submission.description}
Category: ${submission.category || "general"}
Current upvotes: ${submission.upvotes}

Please review this submission, explore the codebase, and take appropriate action.`,
    },
  ];

  let turn = 0;
  while (true) {
    turn++;
    if (turn > MAX_TURNS) {
      console.error(`${sub} ❌ Agent exceeded max turns (${MAX_TURNS}), aborting`);
      throw new Error(`Agent exceeded max turns (${MAX_TURNS}) for submission ${submission.id}`);
    }

    const response = await callWithRetry(
      () =>
        client.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 16384,
          system: SYSTEM_PROMPT,
          tools: toolDefinitions,
          messages,
        }),
      sub
    );

    console.log(`${sub} 📊 Turn ${turn}: stop_reason=${response.stop_reason}, usage=${JSON.stringify(response.usage)}`);

    // Push the full assistant response onto history
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      const textBlocks = response.content.filter((b) => b.type === "text");
      const finalText = textBlocks.map((b) => b.text).join("\n");
      console.log(`\n${sub} ✅ Agent finished for "${submission.title}" in ${turn} turns`);
      return finalText;
    }

    const toolUseBlocks = response.content.filter(
      (b) => b.type === "tool_use"
    );

    if (toolUseBlocks.length === 0 && response.stop_reason !== "end_turn") {
      console.log(
        `${sub}   ⚠️  Response truncated (stop_reason: ${response.stop_reason}), prompting continuation`
      );
      messages.push({
        role: "user",
        content: "Your response was truncated. Please continue where you left off.",
      });
      continue;
    }

    if (toolUseBlocks.length > 0) {
      if (response.stop_reason === "max_tokens") {
        console.log(
          `${sub}   ⚠️  Response hit max_tokens mid-tool-use, executing complete tool blocks and prompting continuation`
        );
      }

      const toolResults = [];
      for (const toolUse of toolUseBlocks) {
        console.log(`${sub}   🔧 Tool: ${toolUse.name}`);
        const result = await executeTool(toolUse.name, toolUse.input);
        const preview =
          result.length > 200 ? result.substring(0, 200) + "…" : result;
        console.log(`${sub}      ↳ ${preview}`);

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result,
        });
      }

      if (response.stop_reason === "max_tokens") {
        toolResults.push({
          type: "text",
          text: "Note: Your previous response was truncated due to max_tokens. The tool calls above were executed successfully. If you had additional tool calls or actions planned, please continue.",
        });
      }

      messages.push({ role: "user", content: toolResults });
    }
  }
}

export async function markSubmissionComplete(submissionId, prUrl) {
  const sub = `[sub:${submissionId}]`;
  console.log(
    `\n${sub} 🎉 Marking submission ${submissionId} as complete (PR: ${prUrl})`
  );

  const messages = [
    {
      role: "user",
      content: `A pull request that was created for feedback submission #${submissionId} has been merged!

PR URL: ${prUrl}

Please:
1. Post a friendly comment on submission ${submissionId} letting the user know their feedback led to a change that is now live and explain the change in a user friendly way. Be celebratory and thankful.
2. Update the submission status to "completed".`,
    },
  ];

  let turn = 0;
  while (true) {
    turn++;
    if (turn > MAX_TURNS) {
      console.error(`${sub} ❌ Completion agent exceeded max turns (${MAX_TURNS}), aborting`);
      throw new Error(`Completion agent exceeded max turns (${MAX_TURNS}) for submission ${submissionId}`);
    }

    const response = await callWithRetry(
      () =>
        client.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 8192,
          system: COMPLETION_PROMPT,
          tools: toolDefinitions,
          messages,
        }),
      sub
    );

    console.log(`${sub} 📊 Turn ${turn}: stop_reason=${response.stop_reason}, usage=${JSON.stringify(response.usage)}`);

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      break;
    }

    const toolUseBlocks = response.content.filter(
      (b) => b.type === "tool_use"
    );

    if (toolUseBlocks.length === 0 && response.stop_reason !== "end_turn") {
      console.log(
        `${sub}   ⚠️  Response truncated (stop_reason: ${response.stop_reason}), prompting continuation`
      );
      messages.push({
        role: "user",
        content: "Your response was truncated. Please continue where you left off.",
      });
      continue;
    }

    if (toolUseBlocks.length > 0) {
      if (response.stop_reason === "max_tokens") {
        console.log(
          `${sub}   ⚠️  Response hit max_tokens mid-tool-use, executing complete tool blocks and prompting continuation`
        );
      }

      const toolResults = [];
      for (const toolUse of toolUseBlocks) {
        console.log(`${sub}   🔧 Tool: ${toolUse.name}`);
        const result = await executeTool(toolUse.name, toolUse.input);
        const preview =
          result.length > 200 ? result.substring(0, 200) + "…" : result;
        console.log(`${sub}      ↳ ${preview}`);

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result,
        });
      }

      if (response.stop_reason === "max_tokens") {
        toolResults.push({
          type: "text",
          text: "Note: Your previous response was truncated due to max_tokens. The tool calls above were executed successfully. If you had additional tool calls or actions planned, please continue.",
        });
      }

      messages.push({ role: "user", content: toolResults });
    }
  }

  console.log(`${sub} ✅ Submission ${submissionId} marked as complete in ${turn} turns.`);
}

export async function reviewSubmission(submissionId) {
  const sub = `[sub:${submissionId}]`;
  console.log(`\n${sub} 💬 Reviewing submission ${submissionId}`);

  const messages = [
    {
      role: "user",
      content: `Please read feedback submission #${submissionId} and leave a short, thoughtful reply thanking the user and engaging with their feedback.`,
    },
  ];

  let turn = 0;
  while (true) {
    turn++;
    if (turn > MAX_TURNS) {
      console.error(`${sub} ❌ Review agent exceeded max turns (${MAX_TURNS}), aborting`);
      throw new Error(`Review agent exceeded max turns (${MAX_TURNS}) for submission ${submissionId}`);
    }

    const response = await callWithRetry(
      () =>
        client.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 8192,
          system: REVIEW_PROMPT,
          tools: toolDefinitions,
          messages,
        }),
      sub
    );

    console.log(`${sub} 📊 Turn ${turn}: stop_reason=${response.stop_reason}, usage=${JSON.stringify(response.usage)}`);

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      break;
    }

    const toolUseBlocks = response.content.filter(
      (b) => b.type === "tool_use"
    );

    if (toolUseBlocks.length === 0 && response.stop_reason !== "end_turn") {
      console.log(
        `${sub}   ⚠️  Response truncated (stop_reason: ${response.stop_reason}), prompting continuation`
      );
      messages.push({
        role: "user",
        content: "Your response was truncated. Please continue where you left off.",
      });
      continue;
    }

    if (toolUseBlocks.length > 0) {
      if (response.stop_reason === "max_tokens") {
        console.log(
          `${sub}   ⚠️  Response hit max_tokens mid-tool-use, executing complete tool blocks and prompting continuation`
        );
      }

      const toolResults = [];
      for (const toolUse of toolUseBlocks) {
        console.log(`${sub}   🔧 Tool: ${toolUse.name}`);
        const result = await executeTool(toolUse.name, toolUse.input);
        const preview =
          result.length > 200 ? result.substring(0, 200) + "…" : result;
        console.log(`${sub}      ↳ ${preview}`);

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result,
        });
      }

      if (response.stop_reason === "max_tokens") {
        toolResults.push({
          type: "text",
          text: "Note: Your previous response was truncated due to max_tokens. The tool calls above were executed successfully. If you had additional tool calls or actions planned, please continue.",
        });
      }

      messages.push({ role: "user", content: toolResults });
    }
  }

  console.log(`${sub} ✅ Review comment posted for submission ${submissionId} in ${turn} turns.`);
}
