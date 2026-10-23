/**
 * Scanning limits (PLAN.md E3 phase 8). App behaviour, not clinic details.
 * The hard caps mirror the server's upload rules (private.file_rule): a document file
 * may be at most 3 MB, a thumbnail 100 KB. Phone scans take at most 30 pages
 * (phone_scan_begin_page).
 */
export const SCAN = {
  /** One saved document (single image or the assembled PDF). Same as file_rule('document'). */
  docCapBytes: 3 * 1024 * 1024,
  /** Aim per page: ~1.5 pages × this ≈ PLAN.md C8's 350 KB per scan. */
  pageTargetBytes: 450 * 1024,
  /** Thumbnail shown in the Documents tab. file_rule('thumbnail') allows 100 KB. */
  thumbCapBytes: 90 * 1024,
  thumbSide: 320,
  /** Photos are decoded at most this big (memory), and pages come out at most this big. */
  decodeSide: 2800,
  pageSide: 2000,
  /** Below this the text gets hard to read, so compression stops shrinking. */
  minPageSide: 900,
  maxPages: 30,
  /** Room left in the PDF for its own structure. */
  pdfOverheadBytes: 64 * 1024,
} as const;
