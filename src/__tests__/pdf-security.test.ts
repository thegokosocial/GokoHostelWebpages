import { describe, expect, it } from "vitest";
import { isPasswordProtectedPdf } from "@/lib/pdfSecurity";

const bytes = (value: string) => new TextEncoder().encode(value);

describe("PDF password detection", () => {
  it("detects the standard PDF encryption trailer entry without rejecting an ordinary PDF", () => {
    expect(isPasswordProtectedPdf(bytes("%PDF-1.7\ntrailer << /Encrypt 5 0 R >>"))).toBe(true);
    expect(isPasswordProtectedPdf(bytes("%PDF-1.7\ntrailer << /Root 1 0 R >>"))).toBe(false);
  });
});
