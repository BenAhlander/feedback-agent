import { Octokit } from "@octokit/rest";

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const owner = process.env.GITHUB_OWNER;
const repo = process.env.GITHUB_REPO;
const appApiUrl = process.env.APP_API_URL;

const appHeaders = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${process.env.APP_API_SECRET}`,
};

export const toolDefinitions = [
  {
    name: "list_directory",
    description:
      "List files and directories at a given path in the GitHub repository. Returns a formatted list with emoji indicators (📁 for directories, 📄 for files).",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "The directory path to list, relative to the repo root. Use empty string for root.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "read_file",
    description:
      "Read the contents of a file from the GitHub repository. Returns the raw text content.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "The file path relative to the repo root.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "search_files",
    description:
      "Search for files in the GitHub repository matching a code search pattern. Returns a list of matching file paths.",
    input_schema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description:
            "The search query (code search pattern) to find files in the repo.",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "post_comment",
    description:
      "Post a public comment on a feedback submission. Comments are visible to users so they should be warm and clear.",
    input_schema: {
      type: "object",
      properties: {
        submission_id: {
          type: "string",
          description: "The ID of the submission to comment on.",
        },
        body: {
          type: "string",
          description: "The comment text to post.",
        },
        status: {
          type: "string",
          description:
            "Optional status to include with the comment (open, under_review, in_progress, completed, declined).",
        },
      },
      required: ["submission_id", "body"],
    },
  },
  {
    name: "update_status",
    description:
      "Update the status of a feedback submission. Valid statuses: open, under_review, in_progress, completed, declined.",
    input_schema: {
      type: "object",
      properties: {
        submission_id: {
          type: "string",
          description: "The ID of the submission to update.",
        },
        status: {
          type: "string",
          description:
            "The new status value (open, under_review, in_progress, completed, declined).",
        },
      },
      required: ["submission_id", "status"],
    },
  },
  {
    name: "create_pull_request",
    description:
      "Create a draft pull request on the GitHub repository with one or more file changes. Handles both new and existing files.",
    input_schema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "The pull request title.",
        },
        body: {
          type: "string",
          description: "The pull request description.",
        },
        branch_name: {
          type: "string",
          description:
            "The name for the new branch (e.g. feedback/fix-button-color).",
        },
        submission_id: {
          type: "string",
          description:
            "The feedback submission ID this PR is related to.",
        },
        files: {
          type: "array",
          description: "Array of files to create or update in the PR.",
          items: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "File path relative to repo root.",
              },
              content: {
                type: "string",
                description: "The full file content.",
              },
            },
            required: ["path", "content"],
          },
        },
      },
      required: ["title", "body", "branch_name", "submission_id", "files"],
    },
  },
];

async function listDirectory({ path }) {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path });
    const items = Array.isArray(data) ? data : [data];
    const lines = items.map((item) => {
      const icon = item.type === "dir" ? "📁" : "📄";
      return `${icon} ${item.name}`;
    });
    return lines.join("\n");
  } catch (err) {
    return `Error listing directory "${path}": ${err.message}`;
  }
}

async function readFile({ path }) {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path });
    const content = Buffer.from(data.content, "base64").toString("utf-8");
    return content;
  } catch (err) {
    return `Error reading file "${path}": ${err.message}`;
  }
}

async function searchFiles({ pattern }) {
  try {
    const query = `${pattern} repo:${owner}/${repo}`;
    const { data } = await octokit.search.code({ q: query });
    if (data.items.length === 0) {
      return "No files found matching that pattern.";
    }
    return data.items.map((item) => item.path).join("\n");
  } catch (err) {
    return `Error searching files: ${err.message}`;
  }
}

async function postComment({ submission_id, body, status }) {
  try {
    const payload = { body, is_agent_comment: true };
    if (status) payload.status = status;
    const res = await fetch(
      `${appApiUrl}/submissions/${submission_id}/comments`,
      {
        method: "POST",
        headers: appHeaders,
        body: JSON.stringify(payload),
      }
    );
    if (!res.ok) {
      const text = await res.text();
      return `Error posting comment (${res.status}): ${text}`;
    }
    return "Comment posted successfully.";
  } catch (err) {
    return `Error posting comment: ${err.message}`;
  }
}

async function updateStatus({ submission_id, status }) {
  try {
    const res = await fetch(
      `${appApiUrl}/submissions/${submission_id}/status`,
      {
        method: "PATCH",
        headers: appHeaders,
        body: JSON.stringify({ status }),
      }
    );
    if (!res.ok) {
      const text = await res.text();
      return `Error updating status (${res.status}): ${text}`;
    }
    return `Status updated to "${status}".`;
  } catch (err) {
    return `Error updating status: ${err.message}`;
  }
}

async function createPullRequest({
  title,
  body,
  branch_name,
  submission_id,
  files,
}) {
  try {
    // Get the default branch and its latest commit SHA
    const { data: repoData } = await octokit.repos.get({ owner, repo });
    const defaultBranch = repoData.default_branch;
    const { data: refData } = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${defaultBranch}`,
    });
    const baseSha = refData.object.sha;

    // Create a new branch from the default branch
    await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branch_name}`,
      sha: baseSha,
    });

    // Commit each file (handle both new and existing files)
    for (const file of files) {
      let existingSha;
      try {
        const { data: existing } = await octokit.repos.getContent({
          owner,
          repo,
          path: file.path,
          ref: branch_name,
        });
        existingSha = existing.sha;
      } catch {
        // File doesn't exist yet — that's fine
      }

      const params = {
        owner,
        repo,
        path: file.path,
        message: `${title}: update ${file.path}`,
        content: Buffer.from(file.content).toString("base64"),
        branch: branch_name,
      };
      if (existingSha) params.sha = existingSha;

      await octokit.repos.createOrUpdateFileContents(params);
    }

    // Open a draft pull request
    const prBody = `${body}\n\n---\n_Auto-generated from feedback submission #${submission_id}_`;
    const { data: pr } = await octokit.pulls.create({
      owner,
      repo,
      title,
      body: prBody,
      head: branch_name,
      base: defaultBranch,
      draft: true,
    });

    return `Pull request created: ${pr.html_url} (#${pr.number})`;
  } catch (err) {
    return `Error creating pull request: ${err.message}`;
  }
}

const toolHandlers = {
  list_directory: listDirectory,
  read_file: readFile,
  search_files: searchFiles,
  post_comment: postComment,
  update_status: updateStatus,
  create_pull_request: createPullRequest,
};

export async function executeTool(toolName, toolInput) {
  const handler = toolHandlers[toolName];
  if (!handler) {
    return `Unknown tool: ${toolName}`;
  }
  return handler(toolInput);
}
