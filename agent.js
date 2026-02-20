import Anthropic from "@anthropic-ai/sdk";
import { toolDefinitions, executeTool } from "./tools.js";

const client = new Anthropic();

const SYSTEM_PROMPT = `You are a software engineering agent embedded in a Reddit-style feedback platform. Users submit feature requests and bug reports, and when a submission receives enough upvotes, you are dispatched to analyze it and potentially implement it.

Your workflow for every submission:
1. Read the submission details to understand what the user is requesting.
2. Set the submission status to "under_review".
3. Explore the GitHub codebase to assess feasibility — list directories, read relevant files, and search for related code.
4. Post a comment with your assessment. This comment is public and visible to users, so be warm, clear, and helpful. Explain what you found and whether you can implement the change.
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

Your comments are public. Be warm, friendly, and clear. Address the user directly. Explain your reasoning. If you decline, be encouraging and suggest how they might approach the change manually or what a developer should consider.

Valid status values: open, under_review, in_progress, completed, declined.`;

const COMPLETION_PROMPT = `You are a friendly community manager for a film and movie website. You absolutely love films and everything about cinema, and you're genuinely grateful to users who take the time to help make the site better.

When a user's feedback has been implemented, your job is to post a warm, non-technical comment thanking them and letting them know their suggestion is now live. You should:

- Thank the user sincerely for their feedback and for helping improve the site.
- Briefly explain what was changed in plain, everyday language — no code jargon, no file names, no technical details. Focus on what the user will actually notice or experience.
- Reference the pull request link so they can see the update if they're curious.
- Keep the tone enthusiastic, warm, and conversational — like a fellow movie fan who's excited about making the site better together.
- Update the submission status to "completed".

Never use developer terminology like "merged," "PR," "repository," "deploy," or "codebase." Instead say things like "your suggestion has been made live" or "we've updated the site based on your idea."`;

export async function runAgent(submission) {
  console.log(`\n🤖 Agent starting for submission: "${submission.title}"`);

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

  while (true) {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      tools: toolDefinitions,
      messages,
    });

    // Push the full assistant response onto history
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      const textBlocks = response.content.filter((b) => b.type === "text");
      const finalText = textBlocks.map((b) => b.text).join("\n");
      console.log(`\n✅ Agent finished for "${submission.title}"`);
      return finalText;
    }

    // Handle max_tokens or unexpected stop reasons — the response may
    // contain tool_use blocks without a proper stop_reason of "tool_use".
    // We must still provide tool_result blocks for any tool_use in the response.
    const toolUseBlocks = response.content.filter(
      (b) => b.type === "tool_use"
    );

    if (toolUseBlocks.length === 0 && response.stop_reason !== "end_turn") {
      // Truncated response with no tool calls — ask the model to continue
      console.log(
        `  ⚠️  Response truncated (stop_reason: ${response.stop_reason}), prompting continuation`
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
          `  ⚠️  Response hit max_tokens mid-tool-use, returning errors for incomplete calls`
        );
      }

      const toolResults = [];
      for (const toolUse of toolUseBlocks) {
        if (response.stop_reason === "max_tokens") {
          // The tool call may be incomplete/malformed — don't execute it
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: "Error: Response was truncated (max_tokens). This tool call may be incomplete. Please retry with a simpler approach or fewer tools at once.",
            is_error: true,
          });
        } else {
          console.log(`  🔧 Tool: ${toolUse.name}`);
          const result = await executeTool(toolUse.name, toolUse.input);
          const preview =
            result.length > 200 ? result.substring(0, 200) + "…" : result;
          console.log(`     ↳ ${preview}`);

          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: result,
          });
        }
      }

      messages.push({ role: "user", content: toolResults });
    }
  }
}

export async function markSubmissionComplete(submissionId, prUrl) {
  console.log(
    `\n🎉 Marking submission ${submissionId} as complete (PR: ${prUrl})`
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

  while (true) {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 8192,
      system: COMPLETION_PROMPT,
      tools: toolDefinitions,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      break;
    }

    const toolUseBlocks = response.content.filter(
      (b) => b.type === "tool_use"
    );

    if (toolUseBlocks.length === 0 && response.stop_reason !== "end_turn") {
      console.log(
        `  ⚠️  Response truncated (stop_reason: ${response.stop_reason}), prompting continuation`
      );
      messages.push({
        role: "user",
        content: "Your response was truncated. Please continue where you left off.",
      });
      continue;
    }

    if (toolUseBlocks.length > 0) {
      const toolResults = [];
      for (const toolUse of toolUseBlocks) {
        if (response.stop_reason === "max_tokens") {
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: "Error: Response was truncated (max_tokens). This tool call may be incomplete. Please retry with a simpler approach or fewer tools at once.",
            is_error: true,
          });
        } else {
          console.log(`  🔧 Tool: ${toolUse.name}`);
          const result = await executeTool(toolUse.name, toolUse.input);
          const preview =
            result.length > 200 ? result.substring(0, 200) + "…" : result;
          console.log(`     ↳ ${preview}`);

          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: result,
          });
        }
      }

      messages.push({ role: "user", content: toolResults });
    }
  }

  console.log(`✅ Submission ${submissionId} marked as complete.`);
}
