"use client";

import { List, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { StaffRole } from "@pearl/shared";
import { LeadsSheet } from "@/components/leads/leads-sheet";
import { NewLeadDialog } from "@/components/leads/new-lead-dialog";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Page, PageHeader } from "@/components/ui/page";

/** The sales sheet page: a sales executive's home on the web; managers switch to it from Leads. */
export function SheetScreen({ openNew, role }: { openNew: boolean; role: StaffRole }) {
  const t = useTranslations("leads");
  const ts = useTranslations("leads.sheet");
  const router = useRouter();
  const pathname = usePathname();
  const [creating, setCreating] = useState(openNew);
  const isExec = role === "sales_executive";
  const close = () => {
    setCreating(false);
    if (openNew) router.replace(pathname, { scroll: false });
  };
  return (
    <Page>
      <PageHeader
        title={ts("title")}
        description={isExec ? ts("descriptionExec") : ts("description")}
        actions={
          <>
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden />
              {t("newLead")}
            </Button>
            {!isExec && (
              <Button asChild variant="secondary">
                <Link href="/leads">
                  <List aria-hidden />
                  {ts("listView")}
                </Link>
              </Button>
            )}
          </>
        }
      />
      <LeadsSheet canAssign={!isExec} canOverride={role === "admin"} />
      <Dialog open={creating} onOpenChange={(o) => !o && close()}>
        {creating && <NewLeadDialog canAssign={!isExec} onDone={close} />}
      </Dialog>
    </Page>
  );
}
