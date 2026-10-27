"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { FilePlus2, Loader2, Pill, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatINR } from "@pearl/shared";
import { StatTile } from "@/components/kpi/stat-tile";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { newId, rpc } from "@/lib/rpc";
import { useFeedback } from "@/lib/use-feedback";
import { BillsTable } from "./bills-table";
import { PaymentDialog } from "./payment-dialog";
import type { Bill } from "./types";

interface Balance {
  billed_paise: number;
  received_paise: number;
  balance_paise: number;
  advance_paise: number;
}

/** Patient file → Bills: balance, new bill, advance/refund, the patient's bills. */
export function PatientBillsTab({ patientId }: { patientId: string }) {
  const t = useTranslations("bills");
  const router = useRouter();
  const { failed } = useFeedback();
  const [paying, setPaying] = useState(false);
  const balance = useQuery({
    queryKey: ["patient_balance", patientId],
    queryFn: () => rpc<Balance>("patient_balance", { p_patient_id: patientId }),
  });
  // Which new bill is being made: its button spins until the bill page opens (a slow day can take seconds).
  const [making, setMaking] = useState<"procedure_receipt" | "pharmacy_invoice" | null>(null);
  const create = useMutation({
    mutationFn: (type: "procedure_receipt" | "pharmacy_invoice") => rpc<Bill>("create_bill", { p_type: type, p_patient_id: patientId, p_links: {}, p_client_id: newId() }),
    onMutate: (type) => setMaking(type),
    onSuccess: (b) => router.push(`/bills/${b.id}`),
    onError: (e) => {
      setMaking(null);
      failed(e);
    },
  });
  const b = balance.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button disabled={making !== null} onClick={() => create.mutate("procedure_receipt")}>
          {making === "procedure_receipt" ? <Loader2 aria-hidden className="animate-spin" /> : <FilePlus2 aria-hidden />}
          {t("newBill")}
        </Button>
        <Button variant="secondary" disabled={making !== null} onClick={() => create.mutate("pharmacy_invoice")}>
          {making === "pharmacy_invoice" ? <Loader2 aria-hidden className="animate-spin" /> : <Pill aria-hidden />}
          {t("newPharmacyBill")}
        </Button>
        <Button variant="secondary" onClick={() => setPaying(true)}>
          <Wallet aria-hidden />
          {t("advanceOrRefund")}
        </Button>
      </div>
      {b && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label={t("billed")} value={formatINR(b.billed_paise)} />
          <StatTile label={t("received")} value={formatINR(b.received_paise)} />
          <StatTile label={t("balanceDue")} value={formatINR(Math.max(b.balance_paise, 0))} />
          <StatTile label={t("advanceHeld")} value={formatINR(b.advance_paise)} />
        </div>
      )}
      <BillsTable patientId={patientId} />
      <Dialog open={paying} onOpenChange={setPaying}>
        {paying && <PaymentDialog patientId={patientId} onDone={() => (setPaying(false), void balance.refetch())} />}
      </Dialog>
    </div>
  );
}
