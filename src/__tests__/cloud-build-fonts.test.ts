import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

describe("Cloudflare build font safety", () => {
  it("uses local system font stacks instead of build-time Google font downloads", () => {
    expect(read("app/layout.tsx")).not.toMatch(/next\/font\/google/);
    const css = read("app/globals.css");
    expect(css).toContain("--font-mohave:");
    expect(css).toContain("--font-roboto:");
  });
});
