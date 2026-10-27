"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox, PageHeader } from "@/components/ui/form";
import { Page, useAdminBack } from "@/components/ui/page";
import { RowSkeletons } from "@/components/ui/skeletons";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { rpc } from "@/lib/rpc";
import { useFeedback } from "@/lib/use-feedback";

interface Row {
  id: string;
  name: string;
  follow_up_days: number | null;
  sections: number;
  active: boolean;
}

/** Admin → Discharge templates. New ones are saved from a summary ("Save as template"). */
export function TemplatesScreen() {
  const adminBack = useAdminBack();
  const t = useTranslations("dischargeTemplates");
  const queryClient = useQueryClient();
  const { failed } = useFeedback();
  const list = useQuery({ queryKey: ["discharge_templates"], queryFn: () => rpc<Row[]>("discharge_templates_list") });
  const toggle = useMutation({
    mutationFn: (r: Row) => rpc("update_discharge_template", { p_template_id: r.id, p_patch: { active: !r.active } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["discharge_templates"] }),
    onError: failed,
  });
  return (
    <Page>
      <PageHeader back={adminBack} title={t("title")} description={t("description")} />
      <Table>
        <THead>
          <tr>
            <TH>{t("name")}</TH>
            <TH className="text-right">{t("sections")}</TH>
            <TH className="text-right">{t("followUp")}</TH>
            <TH>{t("active")}</TH>
            <TH>
              <span className="sr-only">{t("edit")}</span>
            </TH>
          </tr>
        </THead>
        <tbody>
          {list.isPending && <RowSkeletons asRow rows={3} cols={5} />}
          {list.data?.length === 0 && <EmptyRow colSpan={5}>{t("none")}</EmptyRow>}
          {list.data?.map((r) => (
            <TR key={r.id}>
              <TD className="font-medium">{r.name}</TD>
              <TD className="text-right tabular-nums">{r.sections}</TD>
              <TD className="text-right tabular-nums">{r.follow_up_days ?? "—"}</TD>
              <TD>
                <Checkbox label={t("inUse")} checked={r.active} disabled={toggle.isPending} onChange={() => toggle.mutate(r)} />
              </TD>
              <TD className="text-right">
                <Button variant="ghost" asChild>
                  <Link href={`/admin/discharge-templates/${r.id}`} aria-label={t("editName", { name: r.name })}>
                    <Pencil aria-hidden />
                    {t("edit")}
                  </Link>
                </Button>
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </Page>
  );
}
