// The app's own controls, driven the way a person would (same approach as web/e2e/helpers.ts).
import { pause, type } from "./director.mjs";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A themed Select: open it, click the option. */
export async function choose(page, field, option) {
  await field.click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

/** A library combobox (supplier, medicine, patient…): open, type to search, pick. */
export async function pick(page, field, search, option) {
  await field.click();
  await type(page.getByPlaceholder(/Type to search|Name, phone or UHID|Search/).last(), search, 60);
  await pause(page, 600);
  await page.getByRole("option", { name: option }).first().click();
}

/** MonthPicker: "YYYY-MM". */
export async function pickMonth(page, field, ym, title = "Pick a month") {
  await field.click();
  const picker = page.getByRole("dialog", { name: title });
  const target = picker.locator(`[data-month="${ym}"]`);
  for (let i = 0; i < 30 && (await target.count()) === 0; i++) {
    const shown = await picker.locator("[data-month]").first().getAttribute("data-month");
    await picker.getByRole("button", { name: ym < shown ? "Previous year" : "Next year" }).click();
    await pause(page, 250);
  }
  await target.click();
  await pause(page, 300);
  await picker.getByRole("button", { name: "OK", exact: true }).click();
}

/** DatePicker: "YYYY-MM-DD". */
export async function pickDate(page, field, iso, title = "Pick a date") {
  await field.click();
  const picker = page.getByRole("dialog", { name: title });
  let cell = picker.locator(`td[data-day="${iso}"]:not([data-outside]) button`);
  if ((await cell.count()) === 0) {
    await choose(page, picker.getByRole("combobox", { name: "Year" }).first(), iso.slice(0, 4));
    await choose(page, picker.getByRole("combobox", { name: "Month" }).first(), MONTHS[Number(iso.slice(5, 7)) - 1]);
    cell = picker.locator(`td[data-day="${iso}"]:not([data-outside]) button`);
  }
  await cell.first().click();
  await pause(page, 300);
  await picker.getByRole("button", { name: "OK", exact: true }).click();
}

/** "14:05" → "2:05 PM", for the time lists. */
export function timeLabel(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** Today in India as YYYY-MM-DD, plus `days`. */
export function istDay(days = 0) {
  const d = new Date(Date.now() + 5.5 * 3600_000 + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** DateTimePicker: "YYYY-MM-DDTHH:mm" (the time list is in 15-minute steps). */
export async function pickDateTime(page, field, value, title = "Pick a date and time") {
  const [iso, hhmm] = value.split("T");
  await field.click();
  const picker = page.getByRole("dialog", { name: title });
  let cell = picker.locator(`td[data-day="${iso}"]:not([data-outside]) button`);
  if ((await cell.count()) === 0) {
    await choose(page, picker.getByRole("combobox", { name: "Year" }).first(), iso.slice(0, 4));
    await choose(page, picker.getByRole("combobox", { name: "Month" }).first(), MONTHS[Number(iso.slice(5, 7)) - 1]);
    cell = picker.locator(`td[data-day="${iso}"]:not([data-outside]) button`);
  }
  await cell.first().click();
  await pause(page, 300);
  await choose(page, picker.getByRole("combobox", { name: "Time" }), timeLabel(hhmm));
  await pause(page, 300);
  await picker.getByRole("button", { name: "OK", exact: true }).click();
}
