import { describe, expect, it } from "vitest";
import { encodeEscPosBitImage } from "@/lib/thermalPrint";

describe("encodeEscPosBitImage", () => {
  it("packs dark pixels into 24-dot ESC/POS image bands and feeds the next item line", () => {
    const pixels = new Uint8ClampedArray(16 * 2 * 4).fill(255);
    const setBlack = (x: number, y: number) => {
      const offset = (y * 16 + x) * 4;
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
    };
    setBlack(0, 0);
    setBlack(7, 0);
    setBlack(8, 1);

    const data = encodeEscPosBitImage(16, 2, pixels);

    expect(Array.from(data.slice(0, 5))).toEqual([0x1b, 0x2a, 0x21, 16, 0]);
    expect(data).toHaveLength(5 + 16 * 3 + 1);
    expect(Array.from(data.slice(5, 8))).toEqual([0x80, 0, 0]);
    expect(Array.from(data.slice(5 + 7 * 3, 5 + 8 * 3))).toEqual([0x80, 0, 0]);
    expect(Array.from(data.slice(5 + 8 * 3, 5 + 9 * 3))).toEqual([0x40, 0, 0]);
    expect(data.at(-1)).toBe(0x0a);
  });
});
