/**
 * Makes a photo small enough for upload: longest side ≤ maxSide, WebP (JPEG where the
 * browser can't encode WebP), stepping quality down until it fits maxBytes.
 * PDFs and already-small images pass through unchanged. Full scanning (edges,
 * straightening) arrives with the scanner in Phase 8.
 */
export async function shrinkImage(file: File, maxBytes = 3 * 1024 * 1024, maxSide = 2400): Promise<Blob> {
  if (!file.type.startsWith("image/") || (file.size <= maxBytes && ["image/webp", "image/jpeg", "image/png"].includes(file.type))) {
    return file;
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.85, 0.75, 0.65, 0.5, 0.4]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
    const out = blob && blob.type === "image/webp" ? blob : await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
    if (out && out.size <= maxBytes) return out;
  }
  throw new Error("file_too_large");
}
