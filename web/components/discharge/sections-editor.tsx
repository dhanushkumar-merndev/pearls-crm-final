"use client";

import { ArrowDown, ArrowUp, CirclePlus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { PLACEHOLDER_NAMES } from "@pearl/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { newId } from "@/lib/rpc";

export interface Section {
  key: string;
  title: string;
  body: string;
}
export interface Medication {
  name: string;
  dose: string;
  frequency: string;
  duration: string;
  instructions: string;
  pharmacy_item_id?: string | null;
}

/**
 * Discharge sections with {{placeholders}}. "Insert" puts a placeholder where the cursor was
 * in the last text box used, so staff never have to type the braces.
 */
export function SectionsEditor({
  sections,
  onChange,
  errorOf,
  onEdit,
}: {
  sections: Section[];
  onChange: (s: Section[]) => void;
  /** Message for "sections.<i>.title" / "sections.<i>.body" (useZodForm). */
  errorOf?: (path: string) => string | undefined;
  onEdit?: (path: string) => void;
}) {
  const t = useTranslations("discharge");
  const last = useRef<{ key: string; el: HTMLTextAreaElement } | null>(null);
  const set = (key: string, patch: Partial<Section>) => {
    const i = sections.findIndex((s) => s.key === key);
    for (const field of Object.keys(patch)) onEdit?.(`sections.${i}.${field}`);
    onChange(sections.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  };
  const move = (i: number, by: number) => {
    const next = [...sections];
    const [s] = next.splice(i, 1);
    next.splice(i + by, 0, s!);
    onChange(next);
  };
  function insert(name: string) {
    const target = last.current ?? (sections[0] ? { key: sections[0].key, el: null as unknown as HTMLTextAreaElement } : null);
    if (!target) return;
    const s = sections.find((x) => x.key === target.key);
    if (!s) return;
    const at = target.el?.selectionStart ?? s.body.length;
    const end = target.el?.selectionEnd ?? at;
    const token = `{{${name}}}`;
    set(s.key, { body: s.body.slice(0, at) + token + s.body.slice(end) });
    requestAnimationFrame(() => {
      if (!target.el) return;
      target.el.focus();
      target.el.setSelectionRange(at + token.length, at + token.length);
    });
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2" aria-label={t("placeholders")} role="group">
        <p className="text-[0.9rem] text-text-secondary">{t("placeholdersHint")}</p>
        <div className="flex flex-wrap gap-1.5">
          {PLACEHOLDER_NAMES.map((p) => (
            <button
              key={p}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insert(p)}
              className="min-h-9 rounded-full border border-border bg-secondary px-3 text-[0.85rem] hover:bg-popover-accent"
            >
              {t(`ph.${p}`)}
            </button>
          ))}
        </div>
      </div>
      <ol className="flex flex-col gap-3">
        {sections.map((s, i) => (
          <li key={s.key}>
            <Card className="flex flex-col gap-3">
              <div className="flex flex-wrap items-end gap-2">
                <Field label={t("sectionTitle")} error={errorOf?.(`sections.${i}.title`)} className="min-w-56 flex-1">
                  {(a) => <Input {...a} maxLength={120} value={s.title} onChange={(e) => set(s.key, { title: e.target.value })} />}
                </Field>
                <Button variant="ghost" aria-label={t("moveUp", { n: i + 1 })} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp aria-hidden />
                </Button>
                <Button variant="ghost" aria-label={t("moveDown", { n: i + 1 })} disabled={i === sections.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown aria-hidden />
                </Button>
                <Button variant="ghost" aria-label={t("removeSection", { n: i + 1 })} onClick={() => onChange(sections.filter((x) => x.key !== s.key))}>
                  <Trash2 aria-hidden />
                </Button>
              </div>
              <Field label={t("sectionBody", { title: s.title || t("section", { n: i + 1 }) })} error={errorOf?.(`sections.${i}.body`)}>
                {(a) => (
                  <Textarea
                    {...a}
                    rows={4}
                    maxLength={5000}
                    value={s.body}
                    onFocus={(e) => (last.current = { key: s.key, el: e.currentTarget })}
                    onSelect={(e) => (last.current = { key: s.key, el: e.currentTarget })}
                    onChange={(e) => set(s.key, { body: e.target.value })}
                  />
                )}
              </Field>
            </Card>
          </li>
        ))}
      </ol>
      <Button variant="secondary" className="self-start" onClick={() => onChange([...sections, { key: newId(), title: "", body: "" }])}>
        <CirclePlus aria-hidden />
        {t("addSection")}
      </Button>
    </div>
  );
}

const MED_FIELDS = ["name", "dose", "frequency", "duration", "instructions"] as const;

/** Medicines on discharge: one row each (name, dose, how often, how long, instructions). */
export function MedicationsEditor({
  meds,
  onChange,
  errorOf,
  onEdit,
}: {
  meds: Medication[];
  onChange: (m: Medication[]) => void;
  /** Message for "medications.<i>.<field>" (useZodForm). */
  errorOf?: (path: string) => string | undefined;
  onEdit?: (path: string) => void;
}) {
  const t = useTranslations("discharge");
  const set = (i: number, patch: Partial<Medication>) => {
    for (const field of Object.keys(patch)) onEdit?.(`medications.${i}.${field}`);
    onChange(meds.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  };
  return (
    <div className="flex flex-col gap-3">
      {meds.length === 0 && <p className="text-text-secondary">{t("noMeds")}</p>}
      <ol className="flex flex-col gap-3">
        {meds.map((m, i) => (
          <li key={i}>
            <Card className="grid gap-3 md:grid-cols-12 md:items-end">
              {MED_FIELDS.map((f) => (
                <Field
                  key={f}
                  label={t(`med.${f}`)}
                  error={errorOf?.(`medications.${i}.${f}`)}
                  className={f === "name" ? "md:col-span-3" : "md:col-span-2"}
                >
                  {(a) => <Input {...a} maxLength={f === "instructions" ? 200 : 120} value={m[f] ?? ""} onChange={(e) => set(i, { [f]: e.target.value })} />}
                </Field>
              ))}
              <Button variant="ghost" aria-label={t("removeMed", { n: i + 1 })} onClick={() => onChange(meds.filter((_, j) => j !== i))}>
                <Trash2 aria-hidden />
              </Button>
            </Card>
          </li>
        ))}
      </ol>
      <Button variant="secondary" className="self-start" onClick={() => onChange([...meds, { name: "", dose: "", frequency: "", duration: "", instructions: "" }])}>
        <CirclePlus aria-hidden />
        {t("addMed")}
      </Button>
    </div>
  );
}
