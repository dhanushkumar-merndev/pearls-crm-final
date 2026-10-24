import { describe, expect, it } from "vitest";
import { patientDraftSchema, selfRegistrationSchema } from "../src/patient";

const draft = {
  title: "", full_name: "  Asha   Rao ", gender: "female", age_mode: "age", dob: "", age_years: "34", phone: "98450 12345",
  whatsapp_same: true, whatsapp: "", alt_phone: "", email: "", address: "", area: "", city: "", pincode: "",
  attender_name: "", attender_relation: null, attender_phone: "", blood_group: "", allergies: "Dust, Penicillin",
  conditions: "", current_medicines: "", previous_surgeries: "", chief_complaints: "", complaint_since: "",
  heard_from: { id: "11111111-1111-4111-8111-111111111111", label: "Instagram" }, referred_by_text: "", occupation: "",
  preferred_language: "", id_proof_type: "", id_proof_number: "", consent_treatment: true, consent_whatsapp: false,
  consent_marketing: false,
} as const;

const errs = (schema: typeof patientDraftSchema | typeof selfRegistrationSchema, v: Record<string, unknown>) => {
  const r = schema.safeParse(v);
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join("."), i.message]));
};

describe("desk patient form", () => {
  it("becomes the register_patient payload", () => {
    const p = patientDraftSchema.parse(draft);
    expect(p).toMatchObject({
      full_name: "Asha Rao", gender: "female", age_years: 34, phone_e164: "+919845012345", whatsapp_e164: "+919845012345",
      allergies: ["Dust", "Penicillin"], heard_from_id: "11111111-1111-4111-8111-111111111111", email: null, title: null,
    });
    expect(p).not.toHaveProperty("dob");
  });
  it("only the name is required; bad values are reported at the form's field names", () => {
    expect(errs(patientDraftSchema, { ...draft, full_name: " ", phone: "123", whatsapp_same: false, whatsapp: "x", pincode: "0123", email: "a@" })).toEqual({
      full_name: "required", phone: "phone", whatsapp: "phone", pincode: "pincode", email: "email",
    });
    expect(errs(patientDraftSchema, { ...draft, age_years: "130" })).toEqual({ age_years: "age" });
    expect(errs(patientDraftSchema, { ...draft, age_years: "3.5" })).toEqual({ age_years: "age" });
  });
  it("a birth date can't be in the future; by date of birth sends dob, not age", () => {
    expect(errs(patientDraftSchema, { ...draft, age_mode: "dob", dob: "2999-01-01" })).toEqual({ dob: "notFuture" });
    expect(patientDraftSchema.parse({ ...draft, age_mode: "dob", dob: "1990-03-31" })).toMatchObject({ dob: "1990-03-31" });
  });
});

describe("QR self-registration form", () => {
  const self = {
    full_name: "Asha", gender: "female", age_years: "", phone: "9845012345", whatsapp_same: true, whatsapp: "", email: "",
    address: "", city: "", pincode: "", allergies: "", chief_complaints: "", heard_from_id: "", referred_by_text: "",
    attender_name: "", attender_relation_id: "", attender_phone: "", consent_treatment: true, consent_whatsapp: false,
  };
  it("mobile and consent are required there", () => {
    expect(errs(selfRegistrationSchema, { ...self, phone: "", consent_treatment: false })).toEqual({
      phone: "required", consent_treatment: "selfReg.needConsent",
    });
  });
  it("empty fields are left out (the Edge Function takes optional keys)", () => {
    const p = selfRegistrationSchema.parse(self);
    expect(p.email).toBeUndefined();
    expect(p.phone_e164).toBe("+919845012345");
    expect(p.whatsapp_e164).toBe("+919845012345");
  });
});
