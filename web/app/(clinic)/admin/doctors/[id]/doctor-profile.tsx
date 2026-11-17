"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { z } from "zod";
import { formatINR } from "@pearl/shared";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { FieldError } from "@/components/ui/input";
import { shrinkImage } from "@/lib/image";
import { unwrap } from "@/lib/rpc";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { uploadPrivateFile, viewUrls } from "@/lib/upload";
import { useFeedback } from "@/lib/use-feedback";

export interface DoctorProfile {
  id: string;
  full_name: string;
  display_name: string | null;
  specialization: string | null;
  qualification: string | null;
  designation: string | null;
  reg_council: string | null;
  reg_number: string | null;
  consultation_fee_paise: number;
  slot_minutes: number | null;
  signature_file_id: string | null;
}

const SIGNATURE_TYPES = ["image/png", "image/webp"];
const SIGNATURE_MAX = 300 * 1024;
/** The picked file: a picture (PNG/WebP after shrinking, ≤ 300 KB — the server checks again). */
const signatureSchema = z.object({
  file: z
    .custom<File>((v) => v instanceof File, { error: "required" })
    .refine((f) => f.type.startsWith("image/"), { error: "signatureType" }),
});

/** "Doctor saved, now set working hours" after adding one (?new=1). */
export function NewDoctorBanner() {
  const t = useTranslations("doctorPage");
  return (
    <Card role="status" className="flex items-start gap-3 border-status-good">
      <Check aria-hidden className="mt-0.5 size-5 shrink-0 text-good-text" />
      <span>
        <span className="block font-semibold">{t("savedTitle")}</span>
        <span className="block text-text-secondary">{t("savedBody")}</span>
      </span>
    </Card>
  );
}

/** The doctor's details as they print (Edit goes to the doctors list). */
export function DoctorDetails({ doctor }: { doctor: DoctorProfile }) {
  const t = useTranslations("doctorPage");
  const lib = useTranslations("library");
  const rows: [string, string | null][] = [
    [lib("displayName"), doctor.display_name],
    [lib("specialization"), doctor.specialization],
    [lib("qualification"), doctor.qualification],
    [lib("designation"), doctor.designation],
    [lib("regNumber"), [doctor.reg_council, doctor.reg_number].filter(Boolean).join(" ") || null],
    [lib("fee"), formatINR(doctor.consultation_fee_paise)],
    [
      lib("slotMinutes"),
      doctor.slot_minutes ? t("minutes", { n: doctor.slot_minutes }) : t("clinicDefault"),
    ],
  ];
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{t("details")}</CardTitle>
          <CardDescription>{t("detailsHint")}</CardDescription>
        </div>
        <Button asChild variant="secondary">
          <Link href="/admin/libraries/doctors">
            <Pencil aria-hidden />
            {t("edit")}
          </Link>
        </Button>
      </div>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[0.9rem] text-text-secondary">{label}</dt>
            <dd className="truncate">{value || "—"}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** The signature image printed on discharge summaries (admin uploads; PNG or WebP, ≤ 300 KB). */
export function DoctorSignature({ doctor }: { doctor: DoctorProfile }) {
  const t = useTranslations("doctorPage");
  const tv = useTranslations("validation");
  const { saved, failed } = useFeedback();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileId, setFileId] = useState(doctor.signature_file_id);
  const preview = useQuery({
    queryKey: ["doctor_signature", fileId],
    enabled: Boolean(fileId),
    staleTime: 4 * 60_000,
    queryFn: async () => (await viewUrls([fileId!]))[fileId!] ?? null,
  });
  const setSignature = async (id: string | null) =>
    unwrap(
      await getSupabaseBrowser()
        .from("doctors")
        .update({ signature_file_id: id })
        .eq("id", doctor.id)
        .select("id")
        .single(),
    );
  const upload = useMutation({
    mutationFn: async (file: File) => {
      let blob: Blob = file;
      if (!SIGNATURE_TYPES.includes(blob.type) || blob.size > SIGNATURE_MAX)
        blob = await shrinkImage(file, SIGNATURE_MAX, 900);
      if (!SIGNATURE_TYPES.includes(blob.type)) throw new Error("signature_type");
      const { fileId: id } = await uploadPrivateFile(blob, "doctor_signature", {
        linked_table: "doctors",
        linked_id: doctor.id,
      });
      await setSignature(id);
      return id;
    },
    onSuccess: (id) => {
      setFileId(id);
      saved(t("signatureSaved"));
      void queryClient.invalidateQueries({ queryKey: ["doctor_signature"] });
    },
    onError: (e) => {
      if (e instanceof Error && (e.message === "signature_type" || e.message === "file_too_large"))
        return setError(tv("signatureType"));
      failed(e);
    },
  });
  const remove = useMutation({
    mutationFn: () => setSignature(null),
    onSuccess: () => (setFileId(null), saved(t("signatureRemoved"))),
    onError: failed,
  });
  const pick = (files: FileList | null) => {
    setError(null);
    const r = signatureSchema.safeParse({ file: files?.[0] });
    if (!r.success) {
      const key = r.error.issues[0]?.message ?? "required";
      setError(tv(key as "required"));
      input.current?.focus();
      return;
    }
    upload.mutate(r.data.file);
  };
  return (
    <Card className="flex flex-col gap-3">
      <div>
        <CardTitle>{t("signature")}</CardTitle>
        <CardDescription>{t("signatureHint")}</CardDescription>
      </div>
      {fileId ? (
        <div
          className="flex min-h-20 items-center rounded-xl border border-border bg-qr-paper p-3"
          data-testid="signature-preview"
        >
          {preview.data ? (
            // eslint-disable-next-line @next/next/no-img-element -- a 5-minute private link
            <img
              src={preview.data}
              alt={t("signatureAlt", { name: doctor.full_name })}
              className="max-h-16 max-w-60"
            />
          ) : (
            <span className="text-text-secondary">{t("signatureOnFile")}</span>
          )}
        </div>
      ) : (
        <p className="text-text-secondary">{t("noSignature")}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          id="signature-file"
          type="file"
          accept="image/png,image/webp,image/jpeg"
          className="sr-only"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "signature-error" : undefined}
          onChange={(e) => {
            pick(e.target.files);
            e.target.value = "";
          }}
        />
        <Button
          variant="secondary"
          disabled={upload.isPending}
          onClick={() => input.current?.click()}
        >
          <Upload aria-hidden />
          {upload.isPending
            ? t("uploading")
            : fileId
              ? t("replaceSignature")
              : t("uploadSignature")}
        </Button>
        {fileId && (
          <Button variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate()}>
            <Trash2 aria-hidden />
            {t("removeSignature")}
          </Button>
        )}
      </div>
      {error && <FieldError id="signature-error">{error}</FieldError>}
    </Card>
  );
}
