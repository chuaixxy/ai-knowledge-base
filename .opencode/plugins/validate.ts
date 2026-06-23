import type { Plugin } from "@opencode-ai/plugin";
import { join } from "node:path";
import { statSync } from "node:fs";

const GLOB = "knowledge/articles/";

const plugin: Plugin = async (input) => {
  const { $, directory } = input;

  return {
    async "tool.execute.after"(hookInput, output) {
      const { tool, args } = hookInput;

      if (tool !== "write" && tool !== "edit") return;

      const filePath = args?.file_path ?? args?.filePath;
      if (!filePath || typeof filePath !== "string") return;
      if (!filePath.includes(GLOB)) return;

      const absPath = join(directory, filePath);

      try {
        statSync(absPath);
      } catch {
        return;
      }

      try {
        const result = await $`npx tsx hooks/validate-json.ts ${absPath}`.nothrow();
        const text = result.stdout?.toString("utf-8").trim() ?? "";

        if (result.exitCode !== 0) {
          output.title = `校验失败`;
          output.output = text || `exit code: ${result.exitCode}`;
        } else {
          output.title = `校验通过`;
          output.output = text;
        }
      } catch (err) {
        output.title = `校验异常`;
        output.output = err instanceof Error ? err.message : String(err);
      }
    },
  };
};

export default plugin;
