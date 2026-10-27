"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileUser, Save, UserPlus, UserRoundCheck, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PATIENT_SERVER_FIELDS, patientDraftSchema } from "@pearl/shared";
import { draftFrom, emptyDraft, PatientForm, toPayload, type PatientDraft } from "@/components/patients/patient-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, PageHeader } from "@/components/ui/form";
import { Page, StickyActions } from "@/components/ui/page";
import { RowSkeletons } from "@/components/ui/skeletons";
import { newId, rpc, unwrap } from "@/lib/rpc";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";

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

interface LeadForRegistration {
  id: string;
  sl_no: number;
  full_name: string;
  phone_e164: string | null;
  alt_phone_e164: string | null;
  email: string | null;
  referred_by_text: string | null;
  patient_id: string | null;
}

export function RegisterScreen({ requestId, leadId = null }: { requestId: string | null; leadId?: string | null }) {
  const t = useTranslations("common");
  const r = useTranslations("register");
  // Registering a lead who came in (sales booked them): start from what sales typed.
  const lead = useQuery({
    queryKey: ["lead_for_registration", leadId],
    enabled: Boolean(leadId),
    queryFn: () => rpc<LeadForRegistration | null>("lead_for_registration", { p_lead_id: leadId }),
  });
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
  if (leadId && lead.isPending) return <RowSkeletons rows={3} />;
  if (leadId && lead.data?.patient_id) {
    return (
      <Card className="flex flex-col items-start gap-3">
        <p>{r("leadAlreadyRegistered", { n: lead.data.sl_no })}</p>
        <Button asChild>
          <a href={`/patients/${lead.data.patient_id}`}>
            <FileUser aria-hidden />
            {r("openPatientFile")}
          </a>
        </Button>
      </Card>
    );
  }
  const fromLead = lead.data
    ? draftFrom({
        full_name: lead.data.full_name,
        phone_e164: lead.data.phone_e164,
        alt_phone_e164: lead.data.alt_phone_e164,
        email: lead.data.email,
        referred_by_text: lead.data.referred_by_text,
      })
    : null;
  return (
    <RegisterForm
      requestId={requestId}
      requestStatus={request.data?.status ?? null}
      lead={lead.data ? { id: lead.data.id, sl_no: lead.data.sl_no } : null}
      initial={request.data ? draftFrom(request.data.payload) : (fromLead ?? emptyDraft())}
    />
  );
}

function RegisterForm({
  requestId,
  requestStatus,
  lead,
  initial,
}: {
  requestId: string | null;
  requestStatus: string | null;
  lead: { id: string; sl_no: number } | null;
  initial: PatientDraft;
}) {
  const t = useTranslations("register");
  const router = useRouter();
  const { failed } = useFeedback();
  const [draft, setDraft] = useState<PatientDraft>(initial);
  const form = useZodForm(patientDraftSchema);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [clientId] = useState(newId);

  const register = useMutation({
    mutationFn: (args: { decision: "new" | "update" | "family"; targetId?: string; fields?: string[] }) => {
      const payload = toPayload(draft);
      return rpc<{ patient_id: string; uhid: string }>("register_patient", {
        p_payload: payload,
        p_decision: args.decision,
        p_target_id: args.targetId ?? null,
        p_update_fields: args.fields ?? null,
        p_request_id: requestId,
        p_client_id: args.decision === "update" ? null : clientId,
      });
    },
    onSuccess: async (res, args) => {
      if (lead) {
        // The lead's booking, calls and tasks move to the patient file.
        try {
          await rpc("link_lead_to_patient", { p_lead_id: lead.id, p_patient_id: res.patient_id });
        } catch (e) {
          failed(e);
        }
      }
      toast.success(args.decision === "update" ? t("updated", { uhid: res.uhid }) : t("registered", { uhid: res.uhid }));
      router.push(`/patients/${res.patient_id}`);
    },
    onError: (e) => {
      if (!form.fromServer(e, PATIENT_SERVER_FIELDS)) failed(e);
    },
  });

  const check = useMutation({
    mutationFn: (payload: Record<string, unknown>) => {
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
    // Checked before anything is sent; the first bad field gets the focus.
    const payload = form.validate(draft);
    if (!payload) return toast.error(t("fixFields"));
    check.mutate(payload);
  }

  const busy = check.isPending || register.isPending;
  return (
    <Page>
      <PageHeader
        title={requestId ? t("reviewTitle") : t("title")}
        description={requestId ? t("reviewDescription") : t("description")}
      />
      {lead && (
        <Card role="status">
          {t("fromLead", { n: lead.sl_no })}
        </Card>
      )}
      {requestStatus && requestStatus !== "pending" && (
        <Card className="text-text-secondary" role="status">
          {t("alreadyHandled")}
        </Card>
      )}
      <PatientForm draft={draft} onChange={setDraft} errors={form.errors} onEdit={form.clear} />
      <StickyActions>
        <Button size="lg" onClick={save} disabled={busy || requestStatus === "discarded"}>
          <Save aria-hidden />
          {busy ? t("saving") : t("save")}
        </Button>
      </StickyActions>

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
    </Page>
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
    const payload = toPayload(draft);
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
            <ArrowLeft aria-hidden />
            {t("back")}
          </Button>
          <Button disabled={busy || ticked.length === 0} onClick={() => onUpdate(patientId, ticked)}>
            <Save aria-hidden />
            {t("updateTicked", { n: ticked.length })}
          </Button>
        </>
      }
    >
      {stored.isPending && <RowSkeletons rows={3} />}
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
