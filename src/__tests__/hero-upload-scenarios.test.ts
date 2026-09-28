import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clientUploadError, uploadThrowResponse } from "@/lib/websiteUploadErrors";
import { buildHeroUploadRequest, formatHeroUploadPhaseError } from "@/lib/heroUploadRequest";
import { assertHeroEncodedSize, heroEncodeMaxBytes, HERO_ENCODE_LIMITS } from "@/lib/processHeroVideo";
import { WEBSITE_UPLOAD_PATH, config as middlewareConfig } from "@/middleware";

describe("clientUploadError / uploadThrowResponse", () => {
  it("keeps short Error messages and first line of multiline stacks", () => {
    expect(clientUploadError(new Error("R2 put rejected"))).toBe("R2 put rejected");
    expect(clientUploadError(new Error("Network connection lost.\n    at Object.put"))).toBe("Network connection lost.");
  });

  it("never returns empty for non-Error / empty message throws", () => {
    expect(clientUploadError(undefined)).toBe("UPLOAD_ERROR: unexpected upload failure");
    expect(clientUploadError(null)).toBe("UPLOAD_ERROR: unexpected upload failure");
    expect(clientUploadError(new Error(""))).toBe("UPLOAD_ERROR: unexpected upload failure");
    expect(clientUploadError({})).toBe("UPLOAD_ERROR: unexpected upload failure");
    expect(clientUploadError({ message: "" })).toBe("UPLOAD_ERROR: unexpected upload failure");
    expect(clientUploadError({ message: "bucket busy" })).toBe("bucket busy");
    expect(clientUploadError(42)).toBe("42");
  });

  it("uploadThrowResponse always includes UPLOAD_THROW code", () => {
    expect(uploadThrowResponse(new Error("x"))).toEqual({ error: "x", code: "UPLOAD_THROW" });
    expect(uploadThrowResponse(null).code).toBe("UPLOAD_THROW");
    expect(uploadThrowResponse(null).error).toMatch(/^UPLOAD_ERROR:/);
  });
});

describe("buildHeroUploadRequest", () => {
  it("builds raw-body request with auth headers (not FormData)", () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" });
    const { url, init } = buildHeroUploadRequest(blob, "mobile.mp4", { password: "secret", username: "admin" });
    expect(url).toBe("/api/admin/website/upload?folder=hero-videos");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(blob);
    expect(init.headers).toMatchObject({
      "Content-Type": "video/mp4",
      "X-Goko-Password": "secret",
      "X-Goko-Username": "admin",
    });
    expect(init.body).not.toBeInstanceOf(FormData);
  });

  it("infers JPEG type from filename when blob type is empty", () => {
    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff])]);
    const { init } = buildHeroUploadRequest(blob, "desktop-poster.jpg", { password: "x" });
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("image/jpeg");
    expect((init.headers as Record<string, string>)["X-Goko-Username"]).toBeUndefined();
  });
});

describe("formatHeroUploadPhaseError", () => {
  it("prefixes phase and optional status", () => {
    expect(formatHeroUploadPhaseError("upload-video", new Error("R2 put rejected"))).toBe("upload-video: R2 put rejected");
    expect(formatHeroUploadPhaseError("encode", new Error("boom"), 500)).toBe("encode: boom (500)");
    expect(formatHeroUploadPhaseError("save", "not an error")).toBe("save: not an error");
  });
});

describe("hero encode size caps", () => {
  it("exports desktop 8MB and mobile 4MB limits", () => {
    expect(heroEncodeMaxBytes("desktop")).toBe(8 * 1024 * 1024);
    expect(heroEncodeMaxBytes("mobile")).toBe(4 * 1024 * 1024);
    expect(HERO_ENCODE_LIMITS.desktop.width).toBe(1024);
    expect(HERO_ENCODE_LIMITS.mobile.height).toBe(576);
  });

  it("assertHeroEncodedSize accepts under-cap and rejects over-cap", () => {
    expect(() => assertHeroEncodedSize(3 * 1024 * 1024, "mobile")).not.toThrow();
    expect(() => assertHeroEncodedSize(7 * 1024 * 1024, "desktop")).not.toThrow();
    expect(() => assertHeroEncodedSize(4 * 1024 * 1024 + 1, "mobile")).toThrow(/mobile video is over 4MB/);
    expect(() => assertHeroEncodedSize(8 * 1024 * 1024 + 1, "desktop")).toThrow(/desktop video is over 8MB/);
  });

  it("processHeroVideo calls assertHeroEncodedSize after encode", () => {
    const src = readFileSync("src/lib/processHeroVideo.ts", "utf8");
    expect(src).toContain("assertHeroEncodedSize(outData.byteLength, slot)");
    expect(src).not.toContain("15 * 1024 * 1024");
  });
});

describe("middleware excludes website upload from body clone path", () => {
  it("matcher skips /api/admin/website/upload", () => {
    expect(WEBSITE_UPLOAD_PATH).toBe("/api/admin/website/upload");
    const matcher = Array.isArray(middlewareConfig.matcher)
      ? middlewareConfig.matcher.join(" ")
      : String(middlewareConfig.matcher);
    expect(matcher).toContain("admin/website/upload");
    expect(matcher).toContain("?!");
  });

  it("middleware source keeps origin check for other admin POSTs", () => {
    const src = readFileSync("src/middleware.ts", "utf8");
    expect(src).toContain("Invalid request origin");
    expect(src).toContain("/api/admin/");
  });
});

describe("AdminHeroVideos wiring", () => {
  it("uses buildHeroUploadRequest and phase-tagged errors", () => {
    const src = readFileSync("src/components/admin/AdminHeroVideos.tsx", "utf8");
    expect(src).toContain("buildHeroUploadRequest");
    expect(src).toContain("formatHeroUploadPhaseError");
    expect(src).toContain('phase = "upload-video"');
    expect(src).toContain('phase = "upload-poster"');
  });
});
