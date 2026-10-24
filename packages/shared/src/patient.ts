import { z } from "zod";
import { istDateString } from "./dates";
import {
  optionalDate,
  optionalEmail,
  optionalId,
  optionalItem,
  optionalPhone,
  optionalPincode,
  optionalText,
  requiredPhone,
  requiredText,
  wordList,
} from "./validation";

export const PATIENT_TITLES = ["Mr", "Mrs", "Ms", "Miss", "Master", "Baby", "Dr"] as const;
export const GENDERS = ["female", "male", "other", "unknown"] as const;
export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;

const blankOr = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.literal(""), z.enum(values)], { error: "choose" })
    .optional()
    .transform((v) => (v ? v : null));

/** Age in whole years, 0–120, typed as text; empty → null. */
const age = z.preprocess(
  (v) => (v === null || v === undefined || (typeof v === "string" && v.trim() === "") ? null : Number(String(v).trim())),
  z.number({ error: "age" }).int({ error: "age" }).min(0, { error: "age" }).max(120, { error: "age" }).nullable(),
);

/** A birth date can't be after today (IST). */
function notFuture(path: string, value: string | null, ctx: z.RefinementCtx) {
  if (value && value > istDateString(new Date())) ctx.addIssue({ code: "custom", path: [path], message: "notFuture" });
}

/**
 * The desk registration / edit form (web/components/patients/patient-form.tsx) → the payload
 * register_patient and update_patient take. Errors are reported at the form's own field
 * names (phone, whatsapp, attender_relation …); only the name is required.
 */
export const patientDraftSchema = z
  .object({
    title: blankOr(PATIENT_TITLES),
    full_name: requiredText(120),
    gender: z.enum(GENDERS, { error: "choose" }),
    age_mode: z.enum(["dob", "age"]),
    dob: optionalDate(),
    age_years: age,
    phone: optionalPhone(),
    whatsapp_same: z.boolean(),
    whatsapp: optionalPhone(),
    alt_phone: optionalPhone(),
    email: optionalEmail(200),
    address: optionalText(500),
    area: optionalText(120),
    city: optionalText(80),
    pincode: optionalPincode(),
    attender_name: optionalText(120),
    attender_relation: optionalItem(),
    attender_phone: optionalPhone(),
    blood_group: blankOr(BLOOD_GROUPS),
    allergies: wordList(80, 20),
    conditions: wordList(80, 20),
    current_medicines: optionalText(2000),
    previous_surgeries: optionalText(2000),
    chief_complaints: optionalText(2000),
    complaint_since: optionalText(120),
    heard_from: optionalItem(),
    referred_by_text: optionalText(120),
    occupation: optionalText(120),
    preferred_language: optionalText(40),
    id_proof_type: optionalText(40),
    id_proof_number: optionalText(40),
    consent_treatment: z.boolean(),
    consent_whatsapp: z.boolean(),
    consent_marketing: z.boolean(),
  })
  .superRefine((d, ctx) => {
    if (d.age_mode === "dob") notFuture("dob", d.dob, ctx);
  })
  .transform((d) => {
    const payload: Record<string, unknown> = {
      title: d.title,
      full_name: d.full_name.replace(/\s+/g, " "),
      gender: d.gender,
      phone_e164: d.phone,
      whatsapp_e164: d.whatsapp_same ? d.phone : d.whatsapp,
      alt_phone_e164: d.alt_phone,
      email: d.email,
      address: d.address,
      area: d.area,
      city: d.city,
      pincode: d.pincode,
      attender_name: d.attender_name,
      attender_relation_id: d.attender_relation,
      attender_phone_e164: d.attender_phone,
      blood_group: d.blood_group,
      allergies: d.allergies,
      conditions: d.conditions,
      current_medicines: d.current_medicines,
      previous_surgeries: d.previous_surgeries,
      chief_complaints: d.chief_complaints,
      complaint_since: d.complaint_since,
      heard_from_id: d.heard_from,
      referred_by_text: d.referred_by_text,
      occupation: d.occupation,
      preferred_language: d.preferred_language,
      id_proof_type: d.id_proof_type,
      id_proof_number: d.id_proof_number,
      consents: {
        treatment: { given: d.consent_treatment, method: "desk" },
        whatsapp: { given: d.consent_whatsapp, method: "desk" },
        marketing: { given: d.consent_marketing, method: "desk" },
      },
    };
    if (d.age_mode === "dob") payload.dob = d.dob;
    else if (d.age_years !== null) payload.age_years = d.age_years;
    return payload;
  });

export type PatientDraftInput = z.input<typeof patientDraftSchema>;

/** Database detail ("phone_e164") → the desk form's field, for errors the server finds. */
export const PATIENT_SERVER_FIELDS: Record<string, string> = {
  full_name: "full_name",
  phone_e164: "phone",
  whatsapp_e164: "whatsapp",
  alt_phone_e164: "alt_phone",
  attender_phone_e164: "attender_phone",
  age_years: "age_years",
  "date or number": "dob",
};

/**
 * The patient's own phone (QR self-registration, web/app/r/[token]) → the public-form
 * payload. Name, mobile and the treatment consent are required there.
 */
export const selfRegistrationSchema = z
  .object({
    full_name: requiredText(120),
    gender: z.enum(GENDERS, { error: "choose" }),
    age_years: age,
    phone: requiredPhone(),
    whatsapp_same: z.boolean(),
    whatsapp: optionalPhone(),
    email: optionalEmail(200),
    address: optionalText(500),
    city: optionalText(80),
    pincode: optionalPincode(),
    allergies: wordList(80, 20),
    chief_complaints: optionalText(2000),
    heard_from_id: optionalId(),
    referred_by_text: optionalText(120),
    attender_name: optionalText(120),
    attender_relation_id: optionalId(),
    attender_phone: optionalPhone(),
    consent_treatment: z.literal(true, { error: "selfReg.needConsent" }),
    consent_whatsapp: z.boolean(),
  })
  .transform((d) => {
    // undefined (not null) for empty fields: the Edge Function's schema takes optional keys.
    const opt = <T>(v: T | null) => (v === null ? undefined : v);
    return {
      full_name: d.full_name.replace(/\s+/g, " "),
      gender: d.gender,
      age_years: opt(d.age_years),
      phone_e164: d.phone,
      whatsapp_e164: d.whatsapp_same ? d.phone : opt(d.whatsapp),
      email: opt(d.email),
      address: opt(d.address),
      city: opt(d.city),
      pincode: opt(d.pincode),
      allergies: d.allergies,
      chief_complaints: opt(d.chief_complaints),
      heard_from_id: opt(d.heard_from_id),
      referred_by_text: opt(d.referred_by_text),
      attender_name: opt(d.attender_name),
      attender_relation_id: opt(d.attender_relation_id),
      attender_phone_e164: opt(d.attender_phone),
      consents: { treatment: { given: true }, whatsapp: { given: d.consent_whatsapp } },
    };
  });
