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

    if (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter(
        (b) => b.type === "tool_use"
      );

      const toolResults = [];
      for (const toolUse of toolUseBlocks) {
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
1. Post a friendly comment on submission ${submissionId} letting the user know their feedback led to a change that is now live. Include the PR link. Be celebratory and thankful.
2. Update the submission status to "completed".`,
    },
  ];

  const response = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 8096,
    system: SYSTEM_PROMPT,
    tools: toolDefinitions,
    messages,
  });

  messages.push({ role: "assistant", content: response.content });

  // Process any tool calls in the response
  if (response.stop_reason === "tool_use") {
    const toolUseBlocks = response.content.filter(
      (b) => b.type === "tool_use"
    );

    for (const toolUse of toolUseBlocks) {
      console.log(`  🔧 Tool: ${toolUse.name}`);
      const result = await executeTool(toolUse.name, toolUse.input);
      const preview =
        result.length > 200 ? result.substring(0, 200) + "…" : result;
      console.log(`     ↳ ${preview}`);
    }
  }

  console.log(`✅ Submission ${submissionId} marked as complete.`);
}
