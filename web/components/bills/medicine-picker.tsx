"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { LibraryCombobox, type LibraryItem } from "@/components/library-combobox";
import { expiryLabel, qtyLabel, type SaleBatch } from "@/components/pharmacy/format";
import { Field, Select } from "@/components/ui/form";
import { rpc } from "@/lib/rpc";
import type { EditLine } from "./bill-editor";

interface ItemDefaults {
  price_paise?: number;
  gst_rate_bp?: number;
  hsn?: string | null;
}

/**
 * Medicine + batch for one pharmacy line. Batches come in FEFO order; the first sellable
 * one is chosen for a new pick. Expired batches are listed but can't be chosen.
 */
export function MedicinePicker({
  line,
  update,
}: {
  line: EditLine;
  update: (patch: Partial<EditLine> | ((current: EditLine) => Partial<EditLine>)) => void;
}) {
  const t = useTranslations("bill");
  const queryClient = useQueryClient();
  const itemId = line.medicine?.id ?? null;
  const batchesQuery = (id: string | null) => ({
    queryKey: ["batches", id],
    queryFn: () => rpc<SaleBatch[]>("batches_for_sale", { p_item_id: id }),
    staleTime: 10_000,
  });
  const batches = useQuery({ ...batchesQuery(itemId), enabled: itemId !== null });
  const chosen = batches.data?.find((b) => b.id === line.batch_id) ?? null;

  const rateFor = (b: SaleBatch | null, medicine: LibraryItem | null, fallback: number | null) =>
    b ? b.selling_price_paise || b.mrp_paise || ((medicine?.defaults ?? {}) as ItemDefaults).price_paise || 0 : fallback;

  async function pickMedicine(m: LibraryItem | null) {
    const d = (m?.defaults ?? {}) as ItemDefaults;
    // FEFO: the first batch that can be sold is chosen straight away.
    const list = m ? await queryClient.fetchQuery(batchesQuery(m.id)).catch(() => []) : [];
    const first = list.find((b) => !b.expired) ?? null;
    update((cur) => ({
      medicine: m,
      batch_id: first?.id ?? null,
      description: m ? [m.label, m.subtitle?.split(" · ").slice(0, 2).join(" ")].filter(Boolean).join(" ") : cur.description,
      gst_rate_bp: d.gst_rate_bp ?? 0,
      hsn_sac: d.hsn ?? "",
      rate_paise: rateFor(first, m, d.price_paise ?? null),
    }));
  }

  return (
    <>
      <Field label={t("medicine")} className="md:col-span-4">
        {(a) => (
          <LibraryCombobox
            id={a.id}
            kind="pharmacy_item"
            value={line.medicine}
            onChange={(m) => void pickMedicine(m)}
          />
        )}
      </Field>
      <Field
        label={t("batch")}
        className="md:col-span-4"
        error={line.medicine && batches.data && !batches.data.some((b) => !b.expired) ? t("noStock") : chosen && Number(line.qty) > chosen.qty_on_hand ? t("onlyLeft", { n: qtyLabel(chosen.qty_on_hand) }) : undefined}
      >
        {(a) => (
          <Select {...a} value={line.batch_id ?? ""} disabled={!line.medicine} onChange={(e) => {
            const b = batches.data?.find((x) => x.id === e.target.value) ?? null;
            update({ batch_id: b?.id ?? null, rate_paise: rateFor(b, line.medicine, line.rate_paise) });
          }}>
            <option value="">{t("chooseBatch")}</option>
            {line.batch_id && !chosen && <option value={line.batch_id}>{line.rest.batch_no ?? "…"}</option>}
            {batches.data?.map((b) => (
              <option key={b.id} value={b.id} disabled={b.expired}>
                {t(b.expired ? "batchExpired" : "batchOption", { no: b.batch_no, exp: expiryLabel(b.expiry_date), n: qtyLabel(b.qty_on_hand) })}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </>
  );
}
