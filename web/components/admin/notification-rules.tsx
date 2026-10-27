"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { z } from "zod";
import { NOTIFICATION_TYPE_LIST, NOTIFICATION_TYPES, type NotificationType } from "@pearl/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, PageHeader } from "@/components/ui/form";
import { Page, useAdminBack } from "@/components/ui/page";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { unwrap } from "@/lib/rpc";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";

type Rules = Record<NotificationType, { push: boolean; email: boolean }>;

const rulesSchema = z.array(z.object({ type: z.enum(NOTIFICATION_TYPE_LIST), push: z.boolean(), email: z.boolean() }));

/** Admin → Notifications: per kind, ring the phone and/or send an email. The bell always shows it. */
export function NotificationRules() {
  const adminBack = useAdminBack();
  const t = useTranslations("notifyRules");
  const { saved, failed } = useFeedback();
  const queryClient = useQueryClient();
  const stored = useQuery({
    queryKey: ["notification_rules"],
    queryFn: async () =>
      unwrap(await getSupabaseBrowser().from("notification_rules").select("type, push, email")) as { type: string; push: boolean; email: boolean }[],
  });
  return (
    <Page>
      <PageHeader back={adminBack} title={t("title")} description={t("description")} />
      {stored.data && <RulesForm key={stored.dataUpdatedAt} stored={stored.data} onSaved={() => {
        saved();
        void queryClient.invalidateQueries({ queryKey: ["notification_rules"] });
      }} onFailed={failed} />}
      <Card className="flex flex-col gap-2">
        <p>{t("emailHint")}</p>
        <p>
          <Link href="/admin/settings" className="text-link underline-offset-4 hover:underline">{t("summaryLink")}</Link>
          {" · "}
          <Link href="/admin/users" className="text-link underline-offset-4 hover:underline">{t("usersLink")}</Link>
        </p>
      </Card>
    </Page>
  );
}

function RulesForm({ stored, onSaved, onFailed }: { stored: { type: string; push: boolean; email: boolean }[]; onSaved: () => void; onFailed: (e: unknown) => void }) {
  const t = useTranslations("notifyRules");
  const c = useTranslations("common");
  // Copied once from the server (never over unsaved edits).
  const [rules, setRules] = useState<Rules>(() => {
    const out = {} as Rules;
    for (const type of NOTIFICATION_TYPE_LIST) {
      const row = stored.find((r) => r.type === type);
      out[type] = row ? { push: row.push, email: row.email } : { ...NOTIFICATION_TYPES[type] };
    }
    return out;
  });
  const checks = useZodForm(rulesSchema);
  const save = useMutation({
    mutationFn: async () => {
      const clean = checks.validate(NOTIFICATION_TYPE_LIST.map((type) => ({ type, ...rules[type] })));
      if (!clean) return;
      unwrap(await getSupabaseBrowser().from("notification_rules").upsert(clean, { onConflict: "type" }));
    },
    onSuccess: onSaved,
    onError: onFailed,
  });
  const set = (type: NotificationType, key: "push" | "email", on: boolean) => setRules((r) => ({ ...r, [type]: { ...r[type], [key]: on } }));

  return (
    <div className="flex flex-col gap-3">
      <Table>
        <THead>
          <tr>
            <TH>{t("kind")}</TH>
            <TH>{t("push")}</TH>
            <TH>{t("email")}</TH>
          </tr>
        </THead>
        <tbody>
          {NOTIFICATION_TYPE_LIST.map((type) => (
            <TR key={type}>
              <TD>
                <span className="block font-medium">{t(`type.${type}.title`)}</span>
                <span className="block text-[0.95rem] text-text-secondary">{t(`type.${type}.who`)}</span>
              </TD>
              <TD>
                <Checkbox label={t("pushShort")} aria-label={t("pushFor", { kind: t(`type.${type}.title`) })} checked={rules[type].push}
                  onChange={(e) => set(type, "push", e.target.checked)} />
              </TD>
              <TD>
                <Checkbox label={t("emailShort")} aria-label={t("emailFor", { kind: t(`type.${type}.title`) })} checked={rules[type].email}
                  onChange={(e) => set(type, "email", e.target.checked)} />
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
      <Button className="self-start" disabled={save.isPending} onClick={() => save.mutate()}>
        <Save aria-hidden />
        {save.isPending ? c("saving") : c("save")}
      </Button>
    </div>
  );
}
