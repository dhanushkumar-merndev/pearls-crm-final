import { AppError, callFunction, newId } from "./rpc";
import { sha256Hex } from "./sha256";

export type FilePurpose =
  | "prescription" | "document" | "registration_form" | "patient_photo" | "call_recording" | "visit_recording"
  | "voice_note" | "punch_photo" | "selfie" | "doctor_signature" | "pdf" | "thumbnail";

export { sha256Hex };

interface PutResponse {
  file_id: string;
  status: "pending" | "uploaded";
  upload?: { url: string; method: "PUT"; headers: Record<string, string> };
}

/**
 * Private file upload (PLAN.md B1): the bytes go straight from the browser to Tigris
 * through a 5-minute signed link; our servers only check permission, type and size.
 * Retrying with the same clientId is safe. Returns the file id.
 */
export async function uploadPrivateFile(
  file: Blob,
  purpose: FilePurpose,
  link: Record<string, string> = {},
  clientId: string = newId(),
): Promise<{ fileId: string; sha256: string }> {
  const sha256 = await sha256Hex(file);
  const put = await callFunction<PutResponse>("files-sign", {
    op: "put",
    purpose,
    mime: file.type,
    size: file.size,
    sha256,
    link,
    client_id: clientId,
  });
  if (put.status === "pending" && put.upload) {
    const res = await fetch(put.upload.url, { method: "PUT", headers: put.upload.headers, body: file });
    if (!res.ok) throw new AppError("upload_incomplete");
    await callFunction("files-sign", { op: "confirm", file_id: put.file_id });
  }
  return { fileId: put.file_id, sha256 };
}

/** Short-lived view links (5 minutes) for files the user may see. */
export async function viewUrls(fileIds: string[]): Promise<Record<string, string>> {
  if (fileIds.length === 0) return {};
  const res = await callFunction<{ urls: Record<string, string> }>("files-sign", { op: "get", file_ids: fileIds });
  return res.urls ?? {};
}
