import { describe, expect, it } from "vitest";

import { deriveSourceId } from "../workflows/source-id.ts";

describe("deriveSourceId", () => {
  it("uses explicit source_id when present", () => {
    expect(
      deriveSourceId({ source_id: "langgenius/dify", title: "other" }),
    ).toBe("langgenius/dify");
  });

  it("uses GitHub full_name title", () => {
    expect(
      deriveSourceId({ title: "Snailclimb/JavaGuide" }),
    ).toBe("Snailclimb/JavaGuide");
  });

  it("derives owner/repo from GitHub url", () => {
    expect(
      deriveSourceId({
        url: "https://github.com/Snailclimb/JavaGuide",
      }),
    ).toBe("Snailclimb/JavaGuide");
  });

  it("falls back to url for non-GitHub sources", () => {
    expect(
      deriveSourceId({
        title: "Some Paper",
        url: "https://arxiv.org/abs/1234.5678",
      }),
    ).toBe("https://arxiv.org/abs/1234.5678");
  });
});
