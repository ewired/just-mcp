#!/usr/bin/env -S deno run -A
import { FastMCP } from "npm:fastmcp@1.22.4";
import { z } from "npm:zod@3.24.3";
import { basename } from "node:path";

const PROJECT = Deno.env.get("PROJECT") ?? Deno.cwd();

// Get allowed tasks from environment variable if set
const ALLOWED_TASKS =
  Deno.env.get("ALLOWED_TASKS")?.split(",").map((t) => t.trim()) ?? null;

interface TaskParameter {
  name: string;
  isVarArgs: boolean;
}

// Define the structure of a parsed task
interface Task {
  name: string;
  description: string;
  parameters: TaskParameter[];
}

/**
 * Parse `just -l` output
 */
async function getJustTasks(): Promise<Task[]> {
  try {
    // Get task list from just -l
    const { stdout } = await new Deno.Command("just", {
      args: ["-l"],
      cwd: PROJECT,
    }).output();

    const taskList = new TextDecoder().decode(stdout);
    const tasks: Task[] = [];

    // Parse each task from just -l output
    for (const line of taskList.split("\n")) {
      // Match task name, arguments, and documentation comment
      // Example: "some_job notEnvArg $envArg *varargs    # Some job comment"
      const match = line.match(/^\s*(\w+)(?:\s+([^#]*))?(?:\s*#\s*(.*))?/);
      if (!match) continue;

      const [, taskName, argsStr = "", comment = ""] = match;

      // Skip if task is not in allowed list (when ALLOWED_TASKS is set)
      if (ALLOWED_TASKS !== null && !ALLOWED_TASKS.includes(taskName)) {
        continue;
      }

      // Parse parameters from arguments string
      const params = argsStr
        .trim()
        .split(/\s+/)
        .filter((p) => p.trim()) // Only filter out empty strings
        .map((p) => ({
          name: (p.startsWith("$") || p.startsWith("*")) ? p.slice(1) : p,
          isVarArgs: p.startsWith("*"),
        }));

      tasks.push({
        name: taskName,
        description: comment.trim() || `Run the ${taskName} task`,
        parameters: params,
      });
    }

    return tasks;
  } catch (error: unknown) {
    console.error(
      "Error getting just tasks:",
      error instanceof Error ? error.message : String(error),
    );
    return [];
  }
}

/**
 * Convert parameter objects to command line arguments
 */
function processParameters(
  params: Record<string, unknown>,
  parameters: TaskParameter[],
): string[] {
  const args: string[] = [];

  for (const [name, value] of Object.entries(params)) {
    const param = parameters.find((p) => p.name === name);
    if (param?.isVarArgs && Array.isArray(value)) {
      args.push(...value);
    } else if (typeof value === "string") {
      args.push(value);
    }
  }

  return args;
}

/**
 * Execute a just task with given arguments and return its output
 */
async function executeJustTask(
  taskName: string,
  args: string[],
): Promise<string> {
  let output = "";

  const child = new Deno.Command("bash", {
    args: ["-l", "-c", `just ${taskName} "$@"`, "--", ...args],
    cwd: PROJECT,
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  const decoder = new TextDecoder();

  await Promise.all([
    (async () => {
      for await (const chunk of child.stdout) {
        output += decoder.decode(chunk);
      }
    })(),
    (async () => {
      for await (const chunk of child.stderr) {
        output += decoder.decode(chunk);
      }
    })(),
  ]);

  const { code } = await child.status;
  output += `\nProcess exited with code ${code}`;

  return output;
}

const server = new FastMCP({
  name: `Task runner server for ${basename(PROJECT)}`,
  version: "1.0.0",
});

// Log startup information
console.error(`Starting just MCP server for ${PROJECT}`);
if (ALLOWED_TASKS !== null) {
  console.error(`Filtering tasks to: ${ALLOWED_TASKS.join(", ")}`);
}

if (Deno.env.get("ENABLE_DEBUG_TOOL")) {
  server.addTool({
    name: "cwd",
    description: "Get the working directory that the MCP server is running in",
    parameters: z.object({}),
    execute: () => Promise.resolve(PROJECT),
  });
}

// Dynamically add tools for each just task
const tasks = await getJustTasks();
for (const task of tasks) {
  const paramSchema: Record<string, z.ZodTypeAny> = {};
  for (const param of task.parameters) {
    paramSchema[param.name] = param.isVarArgs
      ? z.array(z.string()).describe(
        `Variable arguments for the ${task.name} task`,
      )
      : z.string().describe(
        `Parameter ${param.name} for the ${task.name} task`,
      );
  }

  server.addTool({
    name: task.name,
    description: task.description,
    parameters: z.object(paramSchema),
    execute: async (params) => {
      try {
        const args = processParameters(params, task.parameters);
        const output = await executeJustTask(task.name, args);
        return output;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error
          ? error.message
          : String(error);
        throw new Error(`Failed to execute ${task.name}: ${errorMessage}`);
      }
    },
  });
}

await server.start({ transportType: "stdio" });
