"use client";

import { ChartColumn, FileInput, Plus, Shuffle } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { LeadsTable } from "@/components/leads/leads-table";
import { NewLeadDialog } from "@/components/leads/new-lead-dialog";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/form";

/** Leads: the managers' table, with New lead (also the sidebar's main button), import, pool and dashboard. */
export function LeadsScreen({ openNew }: { openNew: boolean }) {
  const t = useTranslations("leads");
  const router = useRouter();
  const pathname = usePathname();
  const [creating, setCreating] = useState(openNew);
  const close = () => {
    setCreating(false);
    if (openNew) router.replace(pathname, { scroll: false });
  };
  return (
    <div className="flex flex-col gap-2">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden />
              {t("newLead")}
            </Button>
            <Button asChild variant="secondary">
              <Link href="/leads/import">
                <FileInput aria-hidden />
                {t("import")}
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/leads/pool">
                <Shuffle aria-hidden />
                {t("pool")}
              </Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/leads/dashboard">
                <ChartColumn aria-hidden />
                {t("dashboard")}
              </Link>
            </Button>
          </>
        }
      />
      <LeadsTable canAssign />
      <Dialog open={creating} onOpenChange={(o) => !o && close()}>
        {creating && <NewLeadDialog canAssign onDone={close} />}
      </Dialog>
    </div>
  );
}
