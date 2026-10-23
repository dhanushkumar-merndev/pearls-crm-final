import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { s3Storage } from "./storage.ts";

const storage = s3Storage(
  {
    endpoint: "https://storage.example.test",
    region: "auto",
    bucket: "pearl-test",
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "secret-example",
  },
  "20261023T100000Z",
);

Deno.test("upload links expire in 5 minutes and are locked to the file type", async () => {
  const url = new URL(await storage.presignPut("prescription/2026/10/abc.webp", "image/webp", 300));
  assertEquals(url.origin + url.pathname, "https://pearl-test.storage.example.test/prescription/2026/10/abc.webp");
  assertEquals(url.searchParams.get("X-Amz-Expires"), "300");
  assertEquals(url.searchParams.get("X-Amz-SignedHeaders"), "content-type;host");
  assertStringIncludes(url.searchParams.get("X-Amz-Credential") ?? "", "AKIDEXAMPLE/20261023/auto/s3/aws4_request");
  assert(/^[0-9a-f]{64}$/.test(url.searchParams.get("X-Amz-Signature") ?? ""));
});

Deno.test("view links are signed GETs and differ per object", async () => {
  const a = await storage.presignGet("pdf/2026/10/a.pdf", 300);
  const b = await storage.presignGet("pdf/2026/10/b.pdf", 300);
  assertEquals(new URL(a).searchParams.get("X-Amz-SignedHeaders"), "host");
  assert(new URL(a).searchParams.get("X-Amz-Signature") !== new URL(b).searchParams.get("X-Amz-Signature"));
});

Deno.test("keys are URL-encoded per path segment", async () => {
  const url = new URL(await storage.presignGet("document/2026/10/a b.pdf", 60));
  assertStringIncludes(url.pathname, "/document/2026/10/a%20b.pdf");
});

Deno.test("path-style links (MinIO) put the bucket in the path", async () => {
  const minio = s3Storage({
    endpoint: "http://127.0.0.1:9000/",
    region: "auto",
    bucket: "pearl-test",
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "secret-example",
    pathStyle: true,
  });
  const url = new URL(await minio.presignGet("pdf/2026/10/a.pdf", 60));
  assertEquals(url.origin + url.pathname, "http://127.0.0.1:9000/pearl-test/pdf/2026/10/a.pdf");
});
