import { describe, expect, it } from "vitest";
import { sniffImage } from "../src/lib/image-sniff.ts";

const bytes = (...values: number[]) =>
  Uint8Array.from([...values, ...new Array<number>(12).fill(0)]);

describe("sniffImage", () => {
  it("reconoce JPG, PNG y WebP por sus bytes", () => {
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
    expect(sniffImage(webp)).toBe("image/webp");
  });

  it("rechaza lo demás aunque se haga pasar por imagen (GIF, SVG, HTML, PDF, ejecutables)", () => {
    expect(sniffImage(Uint8Array.from(Buffer.from("GIF89a......")))).toBeNull();
    expect(sniffImage(Uint8Array.from(Buffer.from("<svg xmlns=...")))).toBeNull();
    expect(sniffImage(Uint8Array.from(Buffer.from("<html><script>")))).toBeNull();
    expect(sniffImage(Uint8Array.from(Buffer.from("%PDF-1.7......")))).toBeNull();
    expect(sniffImage(Uint8Array.from(Buffer.from("MZ\x90\x00\x03......")))).toBeNull();
    // RIFF que no es WebP (ej. WAV)
    expect(sniffImage(Uint8Array.from(Buffer.from("RIFF....WAVEfmt ")))).toBeNull();
    expect(sniffImage(new Uint8Array(0))).toBeNull();
  });
});
