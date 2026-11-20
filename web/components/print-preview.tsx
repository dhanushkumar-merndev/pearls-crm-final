"use client";

import { ArrowRight, Eye, Printer } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";

export type PrintKind = "bill" | "discharge" | "breakdown" | "quotation";

/**
 * A peek at a paper exactly as it prints (owner, 20/11/2026: "preview button so I can peek and
 * edit"): the print page in a frame, in its uncounted preview mode, so a peek is never a printed copy.
 * `open`: a link to the paper's page (from a list). Without it the button says "Keep editing".
 */
export function PrintPreviewDialog({
  kind,
  id,
  stamp,
  open,
  note,
}: {
  kind: PrintKind;
  id: string;
  /** Changes when the paper is saved, so the frame loads the saved version. */
  stamp?: string | number;
  open?: string;
  /** A line above the paper, e.g. what is still to fill. */
  note?: ReactNode;
}) {
  const t = useTranslations("printPreview");
  return (
    <DialogContent
      title={t(`title.${kind}`)}
      description={t("hint")}
      className="max-w-[54rem]"
      footer={
        <>
          <Button variant="secondary" asChild>
            {/* A plain link: a prefetch would count as a print. */}
            <a href={`/print/${kind}/${id}`} target="_blank" rel="noopener">
              <Printer aria-hidden />
              {t("print")}
            </a>
          </Button>
          {open ? (
            <Button asChild>
              <Link href={open}>
                <ArrowRight aria-hidden />
                {t("open")}
              </Link>
            </Button>
          ) : (
            <DialogClose asChild>
              <Button>
                <ArrowRight aria-hidden />
                {t("keepEditing")}
              </Button>
            </DialogClose>
          )}
        </>
      }
    >
      {note}
      <iframe
        key={`${id}:${stamp ?? ""}`}
        src={`/print/${kind}/${id}?preview=1${stamp !== undefined ? `&v=${stamp}` : ""}`}
        title={t("frame")}
        data-testid="print-preview"
        className="h-[70dvh] w-full rounded-lg border border-border"
      />
    </DialogContent>
  );
}

/** "Preview" button for a row in a list: peeks at that paper, with Open to go to it. */
export function PreviewButton({ kind, id, open }: { kind: PrintKind; id: string; open: string }) {
  const t = useTranslations("printPreview");
  const [shown, setShown] = useState(false);
  return (
    <Dialog open={shown} onOpenChange={setShown}>
      <Button variant="ghost" className="min-h-9 px-3" onClick={() => setShown(true)}>
        <Eye aria-hidden />
        {t("button")}
      </Button>
      {shown && <PrintPreviewDialog kind={kind} id={id} open={open} />}
    </Dialog>
  );
}
