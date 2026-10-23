"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { UserPlus, Users, UserRoundCheck, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { draftFrom, emptyDraft, PatientForm, toPayload, type DraftErrors, type PatientDraft } from "@/components/patients/patient-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, PageHeader } from "@/components/ui/form";
import { newId, rpc, unwrap } from "@/lib/rpc";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useFeedback } from "@/lib/use-feedback";

interface Match {
  id: string;
  uhid: string;
  full_name: string;
  phone_e164: string | null;
  age: number | null;
  gender: string;
  reasons: string[];
}

// payload key → form label key
export const FIELD_LABEL: Record<string, string> = {
  title: "title", full_name: "full_name", gender: "gender", dob: "dob", age_years: "age_years", phone_e164: "phone",
  whatsapp_e164: "whatsapp", alt_phone_e164: "alt_phone", email: "email", address: "address", area: "area", city: "city",
  pincode: "pincode", attender_name: "attender_name", attender_relation_id: "attender_relation",
  attender_phone_e164: "attender_phone", blood_group: "blood_group", allergies: "allergies", conditions: "conditions",
  current_medicines: "current_medicines", previous_surgeries: "previous_surgeries", chief_complaints: "chief_complaints",
  complaint_since: "complaint_since", heard_from_id: "heard_from", referred_by_text: "referred_by_text",
  occupation: "occupation", preferred_language: "preferred_language", id_proof_type: "id_proof_type",
  id_proof_number: "id_proof_number",
};

const shown = (v: unknown) =>
  v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0) ? "—" : Array.isArray(v) ? v.join(", ") : String(v);
const same = (a: unknown, b: unknown) => shown(a).toLowerCase() === shown(b).toLowerCase();

export function RegisterScreen({ requestId }: { requestId: string | null }) {
  const t = useTranslations("common");
  // Reviewing a QR self-registration: load what the patient typed, then start the form from it.
  const request = useQuery({
    queryKey: ["registration_request", requestId],
    enabled: Boolean(requestId),
    queryFn: async () =>
      unwrap(await getSupabaseBrowser().from("registration_requests").select("id, payload, status").eq("id", requestId!).single()) as {
        payload: Record<string, unknown>;
        status: string;
      },
  });
  if (requestId && !request.data) return <p>{request.isError ? t("loadFailed") : t("loading")}</p>;
  return (
    <RegisterForm
      requestId={requestId}
      requestStatus={request.data?.status ?? null}
      initial={request.data ? draftFrom(request.data.payload) : emptyDraft()}
    />
  );
}

function RegisterForm({ requestId, requestStatus, initial }: { requestId: string | null; requestStatus: string | null; initial: PatientDraft }) {
  const t = useTranslations("register");
  const router = useRouter();
  const { failed } = useFeedback();
  const [draft, setDraft] = useState<PatientDraft>(initial);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [clientId] = useState(newId);

  const register = useMutation({
    mutationFn: (args: { decision: "new" | "update" | "family"; targetId?: string; fields?: string[] }) => {
      const { payload } = toPayload(draft);
      return rpc<{ patient_id: string; uhid: string }>("register_patient", {
        p_payload: payload,
        p_decision: args.decision,
        p_target_id: args.targetId ?? null,
        p_update_fields: args.fields ?? null,
        p_request_id: requestId,
        p_client_id: args.decision === "update" ? null : clientId,
      });
    },
    onSuccess: (res, args) => {
      toast.success(args.decision === "update" ? t("updated", { uhid: res.uhid }) : t("registered", { uhid: res.uhid }));
      router.push(`/patients/${res.patient_id}`);
    },
    onError: failed,
  });

  const check = useMutation({
    mutationFn: () => {
      const { payload } = toPayload(draft);
      return rpc<Match[]>("find_patient_matches", {
        p_phone_e164: payload.phone_e164 ?? null,
        p_full_name: payload.full_name,
        p_dob: (payload.dob as string | undefined) ?? null,
      });
    },
    onSuccess: (found) => (found.length ? setMatches(found) : register.mutate({ decision: "new" })),
    onError: failed,
  });

  function save() {
    const { errors: e } = toPayload(draft);
    setErrors(e);
    if (Object.keys(e).length) return toast.error(t("fixFields"));
    check.mutate();
  }

  const busy = check.isPending || register.isPending;
  return (
    <div className="flex flex-col gap-2">
      <PageHeader
        title={requestId ? t("reviewTitle") : t("title")}
        description={requestId ? t("reviewDescription") : t("description")}
        actions={
          <Button onClick={save} disabled={busy || requestStatus === "discarded"}>
            <Save aria-hidden />
            {busy ? t("saving") : t("save")}
          </Button>
        }
      />
      {requestStatus && requestStatus !== "pending" && (
        <Card className="mb-3 text-text-secondary" role="status">
          {t("alreadyHandled")}
        </Card>
      )}
      <PatientForm draft={draft} onChange={setDraft} errors={errors} />
      <div className="mt-4 flex justify-end">
        <Button size="lg" onClick={save} disabled={busy}>
          <Save aria-hidden />
          {busy ? t("saving") : t("save")}
        </Button>
      </div>

      <Dialog open={matches !== null} onOpenChange={(o) => !o && setMatches(null)}>
        {matches && (
          <DuplicateDialog
            matches={matches}
            draft={draft}
            busy={register.isPending}
            onNew={() => register.mutate({ decision: "new" })}
            onFamily={(id) => register.mutate({ decision: "family", targetId: id })}
            onUpdate={(id, fields) => register.mutate({ decision: "update", targetId: id, fields })}
          />
        )}
      </Dialog>
    </div>
  );
}

function DuplicateDialog({
  matches,
  draft,
  busy,
  onNew,
  onFamily,
  onUpdate,
}: {
  matches: Match[];
  draft: PatientDraft;
  busy: boolean;
  onNew: () => void;
  onFamily: (id: string) => void;
  onUpdate: (id: string, fields: string[]) => void;
}) {
  const t = useTranslations("register");
  const f = useTranslations("patientForm");
  const [comparing, setComparing] = useState<string | null>(null);
  const reason = (r: string) => t(`reason.${r}`);

  if (comparing) {
    return <UpdateChooser patientId={comparing} draft={draft} busy={busy} onBack={() => setComparing(null)} onUpdate={onUpdate} />;
  }
  return (
    <DialogContent
      wide
      title={t("maybeTitle")}
      description={t("maybeHint")}
      footer={
        <Button variant="secondary" disabled={busy} onClick={onNew}>
          <UserPlus aria-hidden />
          {t("isNew")}
        </Button>
      }
    >
      <ul className="flex flex-col gap-3">
        {matches.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-border p-4">
            <div className="min-w-0 flex-1">
              <p className="text-lg font-semibold">{m.full_name}</p>
              <p className="text-text-secondary">
                {[m.uhid, m.phone_e164, m.age !== null ? t("age", { n: m.age }) : null, f(`genders.${m.gender}`)].filter(Boolean).join(" · ")}
              </p>
              <p className="text-[0.9rem] text-text-secondary">{t("matchedOn", { why: m.reasons.map(reason).join(", ") })}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => setComparing(m.id)}>
                <UserRoundCheck aria-hidden />
                {t("samePerson")}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => onFamily(m.id)}>
                <Users aria-hidden />
                {t("family")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </DialogContent>
  );
}

/** Same person: show what differs and update only the ticked fields. */
function UpdateChooser({
  patientId,
  draft,
  busy,
  onBack,
  onUpdate,
}: {
  patientId: string;
  draft: PatientDraft;
  busy: boolean;
  onBack: () => void;
  onUpdate: (id: string, fields: string[]) => void;
}) {
  const t = useTranslations("register");
  const f = useTranslations("patientForm");
  const stored = useQuery({
    queryKey: ["patient_header", patientId],
    queryFn: () => rpc<Record<string, unknown>>("patient_header", { p_patient_id: patientId }),
  });
  const diffs = useMemo(() => {
    if (!stored.data) return [];
    const { payload } = toPayload(draft);
    return Object.keys(FIELD_LABEL)
      .filter((k) => k in payload && shown(payload[k]) !== "—" && !same(payload[k], stored.data[k === "age_years" ? "age" : k]))
      .map((k) => {
        // Show list items by name, not id.
        const named: Record<string, [unknown, unknown]> = {
          heard_from_id: [stored.data.heard_from, draft.heard_from?.label],
          attender_relation_id: [stored.data.attender_relation, draft.attender_relation?.label],
        };
        const [before, after] = named[k] ?? [stored.data[k === "age_years" ? "age" : k], payload[k]];
        return { key: k === "age_years" ? "dob" : k, label: f(FIELD_LABEL[k]!), before, after };
      });
  }, [stored.data, draft, f]);
  const [ticked, setTicked] = useState<string[]>([]);

  return (
    <DialogContent
      wide
      title={t("chooseFields", { name: String(stored.data?.full_name ?? "") })}
      description={t("chooseFieldsHint")}
      footer={
        <>
          <Button variant="ghost" onClick={onBack}>
            {t("back")}
          </Button>
          <Button disabled={busy || ticked.length === 0} onClick={() => onUpdate(patientId, ticked)}>
            <Save aria-hidden />
            {t("updateTicked", { n: ticked.length })}
          </Button>
        </>
      }
    >
      {stored.isPending && <p>{t("loading")}</p>}
      {stored.data && diffs.length === 0 && <p className="text-text-secondary">{t("nothingNew")}</p>}
      <ul className="flex flex-col gap-2">
        {diffs.map((d) => (
          <li key={d.key} className="rounded-xl border border-border px-3">
            <Checkbox
              label={d.label}
              hint={`${shown(d.before)} → ${shown(d.after)}`}
              checked={ticked.includes(d.key)}
              onChange={(e) => setTicked((x) => (e.target.checked ? [...x, d.key] : x.filter((k) => k !== d.key)))}
            />
          </li>
        ))}
      </ul>
    </DialogContent>
  );
}
