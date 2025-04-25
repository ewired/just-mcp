#!/usr/bin/env -S deno run -A
import { FastMCP } from "npm:fastmcp@1.22.4";
import { z } from "npm:zod@3.24.3";
import { basename } from "node:path";
import { zodToJsonSchema } from "npm:zod-to-json-schema@3.24.5";

const PROJECT = Deno.env.get("PROJECT") ?? Deno.cwd();

// Get allowed recipes from environment variable if set
const ALLOWED_RECIPES = (Deno.env.get("ALLOWED_RECIPES")?.trim() || null)
  ?.split(",").map((t) => t.trim()) ?? null;

// Just JSON dump interfaces
interface JustParameter {
  name: string;
  kind: "singular" | "star" | "plus";
  default: string | string[] | null;
  export: boolean;
}

interface JustRecipe {
  name: string;
  parameters: JustParameter[];
  doc: string | null;
  body: string[][];
  dependencies: string[];
  private: boolean;
  quiet: boolean;
  shebang: boolean;
}

interface JustfileDump {
  recipes: Record<string, JustRecipe>;
  assignments: Record<string, unknown>;
  settings: Record<string, unknown>;
  aliases: Record<string, unknown>;
  warnings: unknown[];
}

/**
 * Create a Zod schema for a Just parameter
 */
function createParameterSchema(param: JustParameter, recipeName: string) {
  // If default is an array, treat it as an expression and hide it from the user
  if (Array.isArray(param.default)) {
    return param.kind === "star" || param.kind === "plus"
      ? z.array(z.string()).optional().describe(
        `Parameters for the ${recipeName} recipe (default value is an expression in the Justfile)`,
      )
      : z.string().optional().describe(
        `Optional parameter ${param.name} for the ${recipeName} recipe (default value is an expression in the Justfile)`,
      );
  }

  // Handle normal parameters
  if (param.kind === "star" || param.kind === "plus") {
    return param.kind === "plus"
      ? (param.default
        ? z.array(z.string()).optional().describe(
          `Parameters for the ${recipeName} recipe (default: ${param.default})`,
        )
        : z.array(z.string()).min(1).describe(
          `Parameters for the ${recipeName} recipe (at least one required)`,
        ))
      : z.array(z.string()).optional().describe(
        `Parameters for the ${recipeName} recipe (not required)`,
      );
  }

  return param.default
    ? z.string().optional().describe(
      `Optional parameter ${param.name} (default: ${param.default})`,
    )
    : z.string().describe(
      `Required parameter ${param.name}`,
    );
}

/**
 * Get recipes from Just JSON dump
 */
async function getJustRecipes() {
  try {
    // Run just --dump to get the JSON output
    const { stdout } = await new Deno.Command("just", {
      args: [...Deno.args, "--dump", "--dump-format", "json"],
      cwd: PROJECT,
    }).output();

    const justfileData = JSON.parse(new TextDecoder().decode(stdout));
    const justfile = justfileData as JustfileDump;
    return justfile.recipes;
  } catch (error: unknown) {
    console.error(
      "Error getting just recipes:",
      error instanceof Error ? error.message : String(error),
    );
    Deno.exit(1);
  }
}

/**
 * Convert parameter objects to command line arguments
 */
function processParameters(
  params: Record<string, unknown> | null | undefined,
  parameters: JustParameter[],
): string[] {
  const args: string[] = [];

  if (params) {
    for (const [name, value] of Object.entries(params)) {
      const param = parameters.find((p) => p.name === name);
      if (!param) continue;

      if (
        (param.kind === "star" || param.kind === "plus") && Array.isArray(value)
      ) {
        args.push(...value);
      } else if (typeof value === "string") {
        args.push(value);
      }
    }
  }

  return args;
}

/**
 * Execute a just recipe with given arguments and return its output
 */
async function executeRecipe(
  recipeName: string,
  args: string[],
): Promise<string> {
  let output = "";

  const child = new Deno.Command("bash", {
    args: ["-l", "-c", `just ${recipeName} "$@"`, "--", ...Deno.args, ...args],
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
  name: `Just recipe runner for ${basename(PROJECT)}`,
  version: "1.0.0",
});

if (Deno.env.get("ENABLE_DEBUG_TOOL")) {
  server.addTool({
    name: "cwd",
    description: "Get the working directory that the MCP server is running in",
    parameters: z.object({}),
    execute: () => Promise.resolve(PROJECT),
  });
}

// Dynamically add tools for each just recipe
const recipes = await getJustRecipes();
for (const [recipeName, recipe] of Object.entries(recipes)) {
  if (ALLOWED_RECIPES && !ALLOWED_RECIPES.includes(recipeName)) continue;

  const parameters = z.object(Object.fromEntries(
    recipe.parameters
      .map((param) => [param.name, createParameterSchema(param, recipeName)]),
  ));

  if (Deno.env.get("SHOW_RECIPES")) {
    const schema = zodToJsonSchema(parameters);
    console.log({ recipeName, recipe, schema });
    continue;
  }

  server.addTool({
    name: recipeName,
    description: recipe.doc || `Run the ${recipeName} recipe`,
    parameters,
    execute: async (params) => {
      try {
        const args = processParameters(params, recipe.parameters || []);
        const output = await executeRecipe(recipeName, args);
        return output;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error
          ? error.message
          : String(error);
        throw new Error(`Failed to execute ${recipeName}: ${errorMessage}`);
      }
    },
  });
}

if (Deno.env.get("SHOW_RECIPES")) {
  Deno.exit(0);
}

console.error(`Starting just MCP server for ${PROJECT}`);
console.error(
  ALLOWED_RECIPES
    ? `Filtering recipes to: ${ALLOWED_RECIPES.join(", ")}`
    : "All Just recipes are exposed to the client",
);

await server.start({ transportType: "stdio" });
