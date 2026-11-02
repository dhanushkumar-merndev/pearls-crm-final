"use client";

import { useQuery } from "@tanstack/react-query";
import { FilePlus2, Pill, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatINR } from "@pearl/shared";
import { StatTile } from "@/components/kpi/stat-tile";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { rpc } from "@/lib/rpc";
import { BillsTable } from "./bills-table";
import { NewBillDialog } from "./new-bill-dialog";
import { PaymentDialog } from "./payment-dialog";
import { PaymentHistory } from "./payment-history";

interface Balance {
  billed_paise: number;
  received_paise: number;
  balance_paise: number;
  advance_paise: number;
}

/** Patient file → Bills: balance, new bill (first: what is it for?), advance/refund, the patient's bills. */
export function PatientBillsTab({ patientId }: { patientId: string }) {
  const t = useTranslations("bills");
  const [paying, setPaying] = useState(false);
  const [making, setMaking] = useState<"procedure_receipt" | "pharmacy_invoice" | null>(null);
  const balance = useQuery({
    queryKey: ["patient_balance", patientId],
    queryFn: () => rpc<Balance>("patient_balance", { p_patient_id: patientId }),
  });
  const b = balance.data;
  // Balance due = what finalized bills still owe (same as each bill's page). An unused advance is
  // shown beside it, not taken off: it pays a bill only when "Use advance" is chosen on that bill.
  const dues = useQuery({
    queryKey: ["patient_dues", patientId],
    queryFn: () => rpc<{ total_due_paise: number }>("patient_dues", { p_patient_id: patientId }),
    staleTime: 0,
  });
  const due = dues.data?.total_due_paise ?? 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setMaking("procedure_receipt")}>
          <FilePlus2 aria-hidden />
          {t("newBill")}
        </Button>
        <Button variant="secondary" onClick={() => setMaking("pharmacy_invoice")}>
          <Pill aria-hidden />
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
          <StatTile
            label={t("balanceDue")}
            value={formatINR(due)}
            tone={due > 0 ? "warning" : undefined}
            hint={due > 0 && b.advance_paise > 0 ? t("advanceCanPay") : undefined}
          />
          <StatTile label={t("advanceHeld")} value={formatINR(b.advance_paise)} />
        </div>
      )}
      <BillsTable patientId={patientId} />
      <PaymentHistory patientId={patientId} />
      <Dialog open={making !== null} onOpenChange={(o) => !o && setMaking(null)}>
        {making && <NewBillDialog patientId={patientId} type={making} onDone={() => setMaking(null)} />}
      </Dialog>
      <Dialog open={paying} onOpenChange={setPaying}>
        {paying && <PaymentDialog patientId={patientId} onDone={() => (setPaying(false), void balance.refetch(), void dues.refetch())} />}
      </Dialog>
    </div>
  );
}
