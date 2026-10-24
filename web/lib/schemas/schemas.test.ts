import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { clinicProfileSchema, createStaffSchema, numberSeriesSchema } from "./admin";
import { bookSchema, cancelSchema } from "./appointments";
import { billSchema, finalizeSchema, paymentSchema } from "./billing";
import { admissionSchema, doctorHoursSchema, doctorLeaveSchema, editTreatmentSchema, followupSchema, startTreatmentSchema } from "./clinical";
import { adjustStockSchema, purchaseSchema } from "./pharmacy";
import { dripCampaignSchema, dripEnrollSchema, templateSchema, waTemplateSendSchema, waTextSchema } from "./whatsapp";

const errs = (schema: z.ZodType, value: unknown) => {
  const r = schema.safeParse(value);
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join("."), i.message]));
};
const item = (id = "11111111-1111-4111-8111-111111111111") => ({ id, label: "x" });

describe("admin", () => {
  it("clinic profile: name and signatory required; GSTIN, state code, pincode and phones checked", () => {
    const good = {
      name: "Clinic", legal_name: "", gstin: "29abcde1234f1z5", llpin: "", address: "1 Road\n\nTown", city: "", state: "", state_code: "29",
      pincode: "560001", phones: "080 4123 4567", email: "", website: "", letterhead_qr_url: "", signatory_label: "Authorized Signatory",
      logo_path: null, terms: { procedure_receipt: "a\nb", pharmacy_invoice: "", final_bill: "" },
    };
    expect(clinicProfileSchema.parse(good)).toMatchObject({ gstin: "29ABCDE1234F1Z5", address_lines: ["1 Road", "Town"], phones: ["080 4123 4567"] });
    expect(errs(clinicProfileSchema, { ...good, name: "", gstin: "bad", state_code: "2", pincode: "1", phones: "12", website: "x" })).toEqual({
      name: "required", gstin: "gstin", state_code: "clinic.badStateCode", pincode: "pincode", phones: "phone", website: "url",
    });
  });
  it("new staff: username shape, password rule, the admin-users request", () => {
    const r = createStaffSchema.parse({ full_name: "Ravi", role: "receptionist", username: " Ravi.K ", email: "", phone: "9845012345", password: "Pearl2026" });
    expect(r).toEqual({ action: "create", full_name: "Ravi", role: "receptionist", username: "ravi.k", phone_e164: "+919845012345", password: "Pearl2026" });
    expect(errs(createStaffSchema, { full_name: "", role: "", username: "R K", email: "x", phone: "1", password: "short" })).toEqual({
      full_name: "required", role: "choose", username: "username", email: "email", phone: "phone", password: "passwordShort",
    });
  });
  it("number series: needs {n}; next can't go below what was used", () => {
    expect(errs(numberSeriesSchema(965), { prefix: "PAC", format: "{prefix}/{fy}", next_value: "964", padding: "0" })).toEqual({
      format: "settings.series.formatNeedsN", next_value: "min",
    });
  });
});

describe("appointments", () => {
  it("booking needs a patient, doctor and a picked slot", () => {
    expect(errs(bookSchema, { who: null, doctor: null, date: "2026-10-24", slot: null, type: "consultation", notes: "", confirm: false })).toEqual({
      who: "choose", doctor: "choose", slot: "pickSlot",
    });
  });
  it("a cancel reason is a few words", () => {
    expect(errs(cancelSchema, { reason: "no" })).toEqual({ reason: "reasonShort" });
  });
});

describe("clinical", () => {
  it("doctor hours: end after start; leave: last day not before the first", () => {
    expect(errs(doctorHoursSchema, { weekday: "1", start: "13:00", end: "10:00", slot: "", capacity: "" })).toEqual({ end: "timeOrder" });
    expect(errs(doctorHoursSchema, { weekday: "1", start: "10:00", end: "13:00", slot: "3", capacity: "60" })).toEqual({ slot: "min", capacity: "max" });
    expect(errs(doctorLeaveSchema, { from: "2026-11-05", to: "2026-11-01", reason: "" })).toEqual({ to: "dateOrder" });
  });
  it("follow-up can't be due in the past", () => {
    expect(errs(followupSchema, { patient: item(), due: "2020-01-01", reason: "Call" })).toEqual({ due: "notPast" });
  });
  it("treatments: sessions, gaps and price; a price change needs a reason", () => {
    expect(errs(startTreatmentSchema, { template: null, name: "", doctor: null, start: "2026-10-24", sessions: "0", gaps: "0, x", pricing: "package", price: null, agreed: null, notes: "" })).toEqual({
      name: "required", sessions: "min", gaps: "intList", price: "required",
    });
    const edit = editTreatmentSchema({ package_price_paise: 100000, agreed_price_paise: null, status: "active" });
    expect(errs(edit, { name: "Botox", doctor: null, gaps: "0", price: 90000, agreed: null, status: "active", reason: "", notes: "" })).toEqual({
      reason: "treatments.reasonNeeded",
    });
  });
  it("admission: surgery not before admission; a doctor listed once", () => {
    const base = {
      patient: item(), admitted_at: "2026-10-24T10:00", treatment: "", room: null, room_label: "", procedures: "", diagnosis: "", anaesthesia: "",
      surgery_at: "2026-10-24T09:00", attender_name: "", attender_phone: "", attender_relation: "",
      surgeons: [{ doctor: item(), role: "primary" }, { doctor: item(), role: "assistant" }], reason: "",
    };
    expect(errs(admissionSchema(false), base)).toEqual({ surgery_at: "ip.surgeryBeforeAdmission", "surgeons.1.doctor": "duplicateValue" });
    expect(errs(admissionSchema(true), { ...base, surgery_at: "", surgeons: [] })).toEqual({ reason: "required" });
  });
});

describe("billing", () => {
  const line = { kind: "service", description: "Consultation", hsn_sac: "", rate_paise: 50000, qty: "1", discount_type: "amount", discount_amount: 0, discount_percent: "", gst_rate_bp: 0 };
  it("each line: description, rate, quantity; discount within the line amount", () => {
    const schema = billSchema({ taxInclusive: true, amend: false });
    expect(errs(schema, { doctor: null, referred_by: "", lines: [line], reason: "" })).toEqual({});
    expect(errs(schema, { doctor: null, referred_by: "", lines: [{ ...line, description: "", rate_paise: null, qty: "0" }], reason: "" })).toEqual({
      "lines.0.description": "required", "lines.0.rate_paise": "required", "lines.0.qty": "min",
    });
    expect(errs(schema, { doctor: null, referred_by: "", lines: [{ ...line, discount_amount: 60000 }], reason: "" })).toEqual({
      "lines.0.discount_amount": "bill.discountTooBig",
    });
    expect(errs(schema, { doctor: null, referred_by: "", lines: [{ ...line, kind: "pharmacy", medicine: item(), batch_id: null }], reason: "" })).toEqual({
      "lines.0.batch_id": "errors.batch_required",
    });
    expect(errs(schema, { doctor: null, referred_by: "", lines: [], reason: "" })).toEqual({ lines: "noRows" });
  });
  it("an amendment needs a reason", () => {
    expect(errs(billSchema({ taxInclusive: true, amend: true }), { doctor: null, referred_by: "", lines: [line], reason: "" })).toEqual({ reason: "required" });
  });
  it("finalize: no more than due, each amount has a mode, advance within credit", () => {
    const schema = finalizeSchema({ due: 100000, credit: 20000, needsReason: false });
    expect(errs(schema, { use_advance: 30000, rows: [{ key: "a", mode: null, amount: 80000, reference: "" }], reason: "" })).toEqual({
      use_advance: "bill.advanceTooMuch", "rows.0.mode": "choose", "rows.0.amount": "bill.overpaid",
    });
  });
  it("payment: more than ₹0, not more than the bill owes", () => {
    expect(errs(paymentSchema(5000), { kind: "payment", mode: item(), amount: 6000, reference: "", note: "" })).toEqual({ amount: "payment.tooMuch" });
    expect(errs(paymentSchema(null), { kind: "advance", mode: null, amount: 0, reference: "", note: "" })).toEqual({ mode: "choose", amount: "amountPositive" });
  });
});

describe("pharmacy", () => {
  const pl = {
    key: "a", item: item(), batch_no: "B1", expiry: "2099-03", qty: "10", free_qty: "", purchase_price_paise: 1000, mrp_paise: 2000,
    selling_price_paise: 1800, gst_rate_bp: 500,
  };
  it("purchase: expired strip, selling above MRP, the same batch twice", () => {
    expect(errs(purchaseSchema, { supplier: item(), invoice_no: "INV1", invoice_date: "2026-10-01", notes: "", lines: [pl] })).toEqual({});
    expect(errs(purchaseSchema, {
      supplier: null, invoice_no: "", invoice_date: "2999-01-01", notes: "",
      lines: [{ ...pl, expiry: "2020-01", selling_price_paise: 2500 }, { ...pl, key: "b" }],
    })).toEqual({
      supplier: "choose", invoice_no: "required", invoice_date: "notFuture", "lines.0.expiry": "errors.expired_batch",
      "lines.0.selling_price_paise": "pharmacy.sellingAboveMrp",
    });
    // Cross-line checks run once each field is right.
    expect(errs(purchaseSchema, { supplier: item(), invoice_no: "INV1", invoice_date: "2026-10-01", notes: "", lines: [pl, { ...pl, key: "b" }] })).toEqual({
      "lines.1.batch_no": "duplicateValue",
    });
  });
  it("stock adjustment can't remove more than is on hand; a count may be 0", () => {
    expect(errs(adjustStockSchema(5), { kind: "damaged", qty: "6", reason: "Broken strip" })).toEqual({ qty: "errors.stock_insufficient" });
    expect(errs(adjustStockSchema(5), { kind: "count_correction", qty: "0", reason: "Counted" })).toEqual({});
    expect(errs(adjustStockSchema(5), { kind: "patient_return", qty: "0", reason: "Back" })).toEqual({ qty: "errors.invalid_quantity" });
  });
});

describe("whatsapp", () => {
  const ID = "11111111-1111-4111-8111-111111111111";
  it("template: purpose optional, one value per {{n}}", () => {
    expect(templateSchema(2).parse({ purpose: "", variable_map: ["name", "appt_date"], active: true })).toEqual({
      purpose: null, variable_map: ["name", "appt_date"], active: true,
    });
    expect(errs(templateSchema(2), { purpose: "x", variable_map: ["name", ""], active: true })).toEqual({ purpose: "choose", "variable_map.1": "choose" });
    expect(errs(templateSchema(1), { purpose: "followup", variable_map: [], active: true })).toEqual({ variable_map: "choose" });
  });
  it("drip campaign: steps in time order become minutes; trigger must suit the audience", () => {
    const good = {
      name: " Aftercare ", description: "", trigger: "treatment_completed", audience: "patient", stop_on_reply: true, stop_on_booking: true, active: true,
      steps: [{ template_id: ID, days: "0", hours: "2" }, { template_id: ID, days: "7", hours: "0" }],
    };
    expect(dripCampaignSchema.parse(good)).toMatchObject({ name: "Aftercare", description: null, steps: [{ offset_minutes: 120 }, { offset_minutes: 10080 }] });
    expect(errs(dripCampaignSchema, { ...good, audience: "lead" })).toEqual({ trigger: "drips.triggerAudience" });
    expect(errs(dripCampaignSchema, { ...good, trigger: "lead_created" })).toEqual({ trigger: "drips.triggerAudience" });
    expect(dripCampaignSchema.safeParse({ ...good, audience: "lead", trigger: "manual" }).success).toBe(true);
    expect(errs(dripCampaignSchema, { ...good, steps: [good.steps[1], good.steps[0]] })).toEqual({ "steps.1.days": "drips.stepOrder" });
    expect(errs(dripCampaignSchema, { ...good, name: "", steps: [] })).toEqual({ name: "required", steps: "drips.noSteps" });
    expect(errs(dripCampaignSchema, { ...good, steps: [{ template_id: "", days: "", hours: "24" }] })).toEqual({
      "steps.0.template_id": "choose", "steps.0.days": "required", "steps.0.hours": "max",
    });
  });
  it("sending: a template must be picked; text required and at most 4096 characters", () => {
    expect(errs(waTemplateSendSchema, { template_id: "" })).toEqual({ template_id: "choose" });
    expect(errs(waTextSchema, { text: "  " })).toEqual({ text: "required" });
    expect(errs(waTextSchema, { text: "x".repeat(4097) })).toEqual({ text: "tooLong" });
    expect(waTextSchema.parse({ text: " Hi " })).toEqual({ text: "Hi" });
    expect(errs(dripEnrollSchema, { campaign_id: "nope" })).toEqual({ campaign_id: "choose" });
  });
});
