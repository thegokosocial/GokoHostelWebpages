import { describe, expect, it } from "vitest";
import { encodeEscPosRaster } from "@/lib/thermalPrint";

describe("encodeEscPosRaster", () => {
  it("packs dark pixels into a normal-size ESC/POS raster image", () => {
    const pixels = new Uint8ClampedArray(16 * 2 * 4).fill(255);
    const setBlack = (x: number, y: number) => {
      const offset = (y * 16 + x) * 4;
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
    };
    setBlack(0, 0);
    setBlack(7, 0);
    setBlack(8, 1);

    expect(Array.from(encodeEscPosRaster(16, 2, pixels))).toEqual([
      0x1d, 0x76, 0x30, 0, 2, 0, 2, 0,
      0x81, 0, 0, 0x80,
    ]);
  });
});
