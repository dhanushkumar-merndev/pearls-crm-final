"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { FilePlus2, Wallet } from "lucide-react";
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
  const create = useMutation({
    mutationFn: () => rpc<Bill>("create_bill", { p_type: "procedure_receipt", p_patient_id: patientId, p_links: {}, p_client_id: newId() }),
    onSuccess: (b) => router.push(`/bills/${b.id}`),
    onError: failed,
  });
  const b = balance.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button disabled={create.isPending} onClick={() => create.mutate()}>
          <FilePlus2 aria-hidden />
          {t("newBill")}
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
