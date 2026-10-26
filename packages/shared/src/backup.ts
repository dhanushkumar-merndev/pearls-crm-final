/**
 * Backup centre (PLAN.md E3 row 14): where each file goes inside the folder the admin picked,
 * and which files may be purged from the cloud once a verified copy exists.
 * Names must work on Windows and Mac: no \ / : * ? " < > |, no control characters, no
 * trailing dot or space, no reserved device names (CON, NUL, COM1…), and short enough
 * for Windows' 260-character path limit.
 */

/** Heavy media that may leave the cloud after a verified backup. Clinical records never do (PLAN.md F6). */
export const PURGEABLE_PURPOSES = ["call_recording", "visit_recording", "voice_note", "punch_photo", "selfie"] as const;
export type PurgeablePurpose = (typeof PURGEABLE_PURPOSES)[number];

/** Every file kind the backup can copy (thumbnails are rebuilt, so they are left out). */
export const BACKUP_PURPOSES = [
  "prescription", "document", "registration_form", "patient_photo", "doctor_signature", "pdf",
  "call_recording", "visit_recording", "voice_note", "punch_photo", "selfie",
] as const;
export type BackupPurpose = (typeof BACKUP_PURPOSES)[number];

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "audio/amr": "amr",
  "audio/wav": "wav",
};

/** File extension for a stored type ("bin" when unknown). */
export function extensionFor(mime: string): string {
  return EXT[mime.toLowerCase()] ?? "bin";
}

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** One path segment that is safe on Windows and Mac (never empty). */
export function safeSegment(text: string, max = 60): string {
  const cleaned = text
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .replace(/[. ]+$/g, "");
  if (!cleaned) return "_";
  // "CON", "con.txt" and "nul " are device names on Windows whatever follows the dot.
  return RESERVED.test(cleaned.split(".")[0]!.trim()) ? `_${cleaned}` : cleaned;
}

export interface BackupFile {
  id: string;
  purpose: string;
  mime: string;
  /** ISO timestamp the file was stored. */
  created_at: string;
  /** Who or what it belongs to, e.g. "Asha Rao (PC-000123)" or a lead's name. */
  label?: string | null;
}

/**
 * The file's place in the backup folder: purpose/YYYY-MM/YYYY-MM-DD_label_id8.ext (IST dates).
 * The id keeps two files with the same label apart; the same file always gets the same path,
 * so a resumed backup overwrites rather than duplicates.
 */
export function backupPath(f: BackupFile): string[] {
  const ist = new Date(new Date(f.created_at).getTime() + 330 * 60_000).toISOString();
  const day = ist.slice(0, 10);
  const name = `${day}_${f.label ? `${safeSegment(f.label, 60)}_` : ""}${f.id.slice(0, 8)}.${extensionFor(f.mime)}`;
  return [safeSegment(f.purpose), ist.slice(0, 7), safeSegment(name, 100)];
}

/** Database export: one JSON Lines file per table. */
export function exportPath(stamp: string, table: string): string[] {
  return ["database", safeSegment(stamp), `${safeSegment(table)}.jsonl`];
}
