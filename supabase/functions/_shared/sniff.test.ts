import { assertEquals } from "@std/assert";
import { sniffMime } from "./sniff.ts";

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
const pad = (b: Uint8Array) => new Uint8Array([...b, ...new Array(16).fill(0)]);

Deno.test("detects every allowed type by content", () => {
  assertEquals(sniffMime(pad(bytes([0xff, 0xd8, 0xff, 0xe0]))), "image/jpeg");
  assertEquals(sniffMime(pad(bytes([0x89], "PNG\r\n"))), "image/png");
  assertEquals(sniffMime(pad(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "))), "image/webp");
  assertEquals(sniffMime(pad(bytes("%PDF-1.7"))), "application/pdf");
  assertEquals(sniffMime(pad(bytes("OggS", [0]))), "audio/ogg");
  assertEquals(sniffMime(pad(bytes([0, 0, 0, 0x20], "ftypM4A "))), "audio/mp4");
});

Deno.test("a renamed file is not trusted", () => {
  // An HTML page named prescription.jpg
  assertEquals(sniffMime(pad(bytes("<!doctype html>"))), null);
  // GIF is not an allowed type
  assertEquals(sniffMime(pad(bytes("GIF89a"))), null);
  assertEquals(sniffMime(new Uint8Array(4)), null);
});
