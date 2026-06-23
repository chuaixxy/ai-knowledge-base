import type { Plugin, PluginModule } from "@opencode-ai/plugin";
import { resolve } from "node:path";

export const id = "validate";

function getFilePath(args: Record<string, unknown>): string | undefined {
  const directCandidates = [
    args.file_path,
    args.filePath,
    args.filepath,
    args.path,
    args.target,
    args.filename,
  ];

  for (const value of directCandidates) {
    if (typeof value === "string" && value.length > 0) return value;
  }

  for (const value of Object.values(args)) {
    if (
      typeof value === "string" &&
      value.includes("knowledge/articles/") &&
      value.endsWith(".json")
    ) {
      return value;
    }
  }

  return undefined;
}

function isWriteLikeTool(tool: string): boolean {
  const normalized = tool.toLowerCase();
  return normalized === "write" || normalized === "edit";
}

const ValidatePlugin: Plugin = async (input) => ({
  "tool.execute.after": async (event, output) => {
    if (!isWriteLikeTool(event.tool)) return;

    const filePath = getFilePath(event.args ?? {});
    if (!filePath) return;

    const target = resolve(input.directory, filePath);
    if (!target.includes("knowledge/articles/") || !target.endsWith(".json")) return;

    const tsx = resolve(input.directory, "node_modules/.bin/tsx");
    const validator = resolve(input.directory, "hooks/validate-json.ts");
    const quality = resolve(input.directory, "hooks/check-quality.ts");

    try {
      const validateResult = await input.$`${tsx} ${validator} ${target}`.nothrow();
      const validateStdout = validateResult.stdout.toString().trim();
      const validateStderr = validateResult.stderr.toString().trim();

      if (validateResult.exitCode !== 0) {
        const details = [validateStdout, validateStderr].filter(Boolean).join("\n");
        output.title = `JSON validation failed: ${filePath}`;
        output.output = details || `Validation failed for ${filePath}`;
        output.metadata = {
          ...(output.metadata ?? {}),
          validation: {
            status: "failed",
            file: filePath,
            exitCode: validateResult.exitCode,
          },
        };
        return;
      }

      const qualityResult = await input.$`${tsx} ${quality} ${target}`.nothrow();
      const qualityStdout = qualityResult.stdout.toString().trim();
      const qualityStderr = qualityResult.stderr.toString().trim();

      output.metadata = {
        ...(output.metadata ?? {}),
        validation: {
          status: "passed",
          file: filePath,
          output: validateStdout,
        },
        quality: {
          status: qualityResult.exitCode === 0 ? "passed" : "needs_review",
          file: filePath,
          output: [qualityStdout, qualityStderr].filter(Boolean).join("\n"),
        },
      };
    } catch (err) {
      output.title = `Validation crashed: ${filePath}`;
      output.output = String(err);
      output.metadata = {
        ...(output.metadata ?? {}),
        validation: {
          status: "error",
          file: filePath,
        },
      };
    }
  },
});

export default {
  id,
  server: ValidatePlugin,
} satisfies PluginModule;
