"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ListChecks, Plus, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { formatDateTime, readSettings, SETTINGS_SCHEMAS, type Settings } from "@pearl/shared";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Checkbox, Field, Textarea } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { RowSkeletons } from "@/components/ui/skeletons";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyRow, Table, TD, TH, THead, TR, wrapText } from "@/components/ui/table";
import { asAppError, callFunction, rpc, unwrap } from "@/lib/rpc";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useFeedback } from "@/lib/use-feedback";
import { useZodForm } from "@/lib/use-zod-form";
import { cn } from "@/lib/utils";

type Bot = Settings<"wa_bot">;

/** The texts the bot sends, in chat order (each falls back to its built-in text when empty). */
const TEXTS = [
  ["intro_text", 3],
  ["name_text", 1],
  ["products_text", 2],
  ["location_text", 1],
  ["summary_text", 6],
  ["done_text", 2],
  ["cancelled_text", 2],
  ["sorry_text", 1],
  ["media_text", 2],
] as const;
const BUTTONS = ["form_button", "confirm_button", "cancel_button"] as const;
const MAX_PRODUCTS = 20;

interface Overview {
  today: number;
  active: number;
  month_confirmed: number;
  month_cancelled: number;
  month_total: number;
  recent: {
    id: string;
    phone_e164: string;
    name: string | null;
    products: string[];
    location: string | null;
    status: "active" | "confirmed" | "cancelled" | "expired" | "stopped" | "handed_over";
    step: "name" | "products" | "location" | "confirm";
    lead_id: string | null;
    started_at: string;
  }[];
}

const STATUS_KIND = {
  active: "warning",
  confirmed: "good",
  cancelled: "serious",
  expired: "serious",
  stopped: "serious",
  handed_over: "good",
} as const;

/**
 * Admin → WhatsApp → Chat bot: on/off, the treatment list (tick boxes), the brochure link,
 * the daily limit per number, every text it sends, the tick-box form at Meta, and recent chats.
 */
export function ChatBot() {
  const t = useTranslations("waAdmin.bot");
  const { saved, failed, errorMessage } = useFeedback();
  const queryClient = useQueryClient();
  const stored = useQuery({
    queryKey: ["app_settings", "wa_bot"],
    queryFn: async () =>
      unwrap(await getSupabaseBrowser().from("app_settings").select("value, version").eq("section", "wa_bot").maybeSingle()) as {
        value: unknown;
        version: number;
      } | null,
  });
  const overview = useQuery({ queryKey: ["wa_bot_overview"], queryFn: () => rpc<Overview>("wa_bot_overview"), refetchInterval: 60_000 });
  const [form, setForm] = useState<Bot>(() => readSettings("wa_bot", null));
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!stored.isSuccess || loaded) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time copy of server data into the editable form
    setForm(readSettings("wa_bot", stored.data?.value));
    setLoaded(true);
  }, [stored.isSuccess, stored.data, loaded]);

  const checks = useZodForm(SETTINGS_SCHEMAS.wa_bot);
  const set = <K extends keyof Bot>(k: K, v: Bot[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    checks.clear(k);
  };
  const setProducts = (next: string[]) => {
    setForm((f) => ({ ...f, products: next }));
    checks.clear("products");
    next.forEach((_, i) => checks.clear(`products.${i}`));
  };

  const save = useMutation({
    mutationFn: (clean: Bot) => rpc<number>("update_settings", { p_section: "wa_bot", p_value: clean, p_version: stored.data?.version ?? 0 }),
    onSuccess: () => {
      saved();
      setLoaded(false);
      void queryClient.invalidateQueries({ queryKey: ["app_settings"] });
    },
    onError: failed,
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    const clean = checks.validate(form);
    if (clean) save.mutate(clean);
  }

  // The form at Meta. Its ids are written by the server, so copy them back into the open form.
  const [formProblem, setFormProblem] = useState<string | null>(null);
  async function refreshFlowIds() {
    const r = await stored.refetch();
    const v = readSettings("wa_bot", r.data?.value);
    setForm((f) => ({ ...f, flow_id: v.flow_id, flow_draft_id: v.flow_draft_id }));
  }
  const setUpForm = useMutation({
    mutationFn: () =>
      callFunction<{ flow_id: string; published: boolean }>("wa-templates-sync", {
        action: "flow",
        title: t("formTitle"),
        button: t("formSend"),
      }),
    onSuccess: () => saved(t("formReady")),
    onError: (e) => setFormProblem([errorMessage(e), asAppError(e).detail].filter(Boolean).join(" — ")),
    onSettled: () => void refreshFlowIds(),
  });
  const stopForm = useMutation({
    mutationFn: async () => {
      const r = await stored.refetch();
      const v = readSettings("wa_bot", r.data?.value);
      return rpc<number>("update_settings", {
        p_section: "wa_bot",
        p_value: { ...v, flow_id: null, flow_draft_id: null },
        p_version: r.data?.version ?? 0,
      });
    },
    onSuccess: () => {
      saved();
      void refreshFlowIds();
    },
    onError: failed,
  });

  const o = overview.data;
  const formState = form.flow_id ? "ready" : form.flow_draft_id ? "draft" : "none";

  return (
    <section aria-labelledby="bot-title" className="flex flex-col gap-3">
      <Card>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <div>
            <CardTitle id="bot-title">{t("title")}</CardTitle>
            <CardDescription>{t("description")}</CardDescription>
          </div>

          <Checkbox
            label={t("enabled")}
            hint={t("enabledHint")}
            checked={form.enabled}
            onChange={(e) => {
              set("enabled", e.target.checked);
              // Switching on with an empty list: give the first box to fill in.
              if (e.target.checked && form.products.length === 0) setProducts([""]);
            }}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("brochure")} error={checks.error("brochure_url")} hint={t("brochureHint")}>
              {(a) => (
                <Input
                  {...a}
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  value={form.brochure_url ?? ""}
                  onChange={(e) => set("brochure_url", e.target.value.trim() === "" ? null : e.target.value.trim())}
                />
              )}
            </Field>
            <Field label={t("website")} error={checks.error("website_url")} hint={t("websiteHint")}>
              {(a) => (
                <Input
                  {...a}
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  value={form.website_url ?? ""}
                  onChange={(e) => set("website_url", e.target.value.trim() === "" ? null : e.target.value.trim())}
                />
              )}
            </Field>
            <Field label={t("dailyLimit")} error={checks.error("daily_chat_limit")} hint={t("dailyLimitHint")}>
              {(a) => (
                <Input
                  {...a}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={50}
                  value={Number.isFinite(form.daily_chat_limit) ? form.daily_chat_limit : ""}
                  onChange={(e) => set("daily_chat_limit", e.target.value === "" ? Number.NaN : Number(e.target.value))}
                />
              )}
            </Field>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="font-medium">{t("products")}</legend>
            <p className="text-[0.9rem] text-text-secondary">{t("productsHint", { max: MAX_PRODUCTS })}</p>
            {checks.error("products") && (
              <p role="alert" className="text-[0.9rem] text-bad-text">
                {checks.error("products")}
              </p>
            )}
            <ol className="flex flex-col gap-2">
              {form.products.map((p, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-2.5 w-6 shrink-0 text-right tabular-nums text-text-secondary">{i + 1}.</span>
                  <Field label={<span className="sr-only">{t("productN", { n: i + 1 })}</span>} error={checks.error(`products.${i}`)} className="flex-1">
                    {(a) => (
                      <Input
                        {...a}
                        maxLength={30}
                        value={p}
                        aria-invalid={a["aria-invalid"] || (!!checks.error("products") && p.trim() === "")}
                        onChange={(e) => setProducts(form.products.map((x, j) => (j === i ? e.target.value : x)))}
                      />
                    )}
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("moveUp", { n: i + 1 })}
                    disabled={i === 0}
                    onClick={() => setProducts(form.products.map((x, j) => (j === i - 1 ? p : j === i ? form.products[i - 1]! : x)))}
                  >
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("moveDown", { n: i + 1 })}
                    disabled={i === form.products.length - 1}
                    onClick={() => setProducts(form.products.map((x, j) => (j === i + 1 ? p : j === i ? form.products[i + 1]! : x)))}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("remove", { n: i + 1 })}
                    onClick={() => setProducts(form.products.filter((_, j) => j !== i))}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </li>
              ))}
            </ol>
            <Button
              type="button"
              variant="secondary"
              className="self-start"
              disabled={form.products.length >= MAX_PRODUCTS}
              onClick={() => setProducts([...form.products, ""])}
            >
              <Plus aria-hidden />
              {t("addProduct")}
            </Button>
          </fieldset>

          <details className="rounded-xl border border-border p-4">
            <summary className="cursor-pointer font-medium">{t("textsTitle")}</summary>
            <p className="mt-2 text-[0.9rem] text-text-secondary">{t.raw("textsHint")}</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {TEXTS.map(([k, rows]) => (
                <Field key={k} label={t(`text.${k}`)} error={checks.error(k)} className={k === "summary_text" || k === "intro_text" ? "sm:col-span-2" : undefined}>
                  {(a) => (
                    <Textarea
                      {...a}
                      rows={rows}
                      className="min-h-0"
                      placeholder={t.raw(`default.${k}`)}
                      value={form[k] ?? ""}
                      onChange={(e) => set(k, e.target.value)}
                    />
                  )}
                </Field>
              ))}
              {BUTTONS.map((k) => (
                <Field key={k} label={t(`text.${k}`)} error={checks.error(k)}>
                  {(a) => (
                    <Input
                      {...a}
                      maxLength={k === "form_button" ? 30 : 20}
                      placeholder={t.raw(`default.${k}`)}
                      value={form[k] ?? ""}
                      onChange={(e) => set(k, e.target.value)}
                    />
                  )}
                </Field>
              ))}
            </div>
          </details>

          <Button type="submit" disabled={save.isPending || !loaded} className="self-start">
            <Save aria-hidden />
            {save.isPending ? t("saving") : t("save")}
          </Button>
        </form>
      </Card>

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="mr-auto">{t("formCard")}</CardTitle>
          <StatusBadge
            kind={formState === "ready" ? "good" : formState === "draft" ? "warning" : "serious"}
            label={t(`formState.${formState}`)}
          />
        </div>
        <CardDescription>{t(`formHint.${formState}`)}</CardDescription>
        {formProblem && (
          <p role="alert" className="text-bad-text">
            {formProblem}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {formState !== "ready" && (
            <Button variant="secondary" disabled={setUpForm.isPending} onClick={() => (setFormProblem(null), setUpForm.mutate())}>
              <ListChecks aria-hidden />
              {setUpForm.isPending ? t("formWorking") : formState === "draft" ? t("formRetry") : t("formSetUp")}
            </Button>
          )}
          {formState !== "none" && (
            <Button variant="ghost" disabled={stopForm.isPending} onClick={() => stopForm.mutate()}>
              {t("formStop")}
            </Button>
          )}
        </div>
      </Card>

      <section aria-labelledby="bot-chats" className="flex flex-col gap-2">
        <h3 id="bot-chats" className="text-lg font-semibold">
          {t("chatsTitle")}
        </h3>
        {o && (
          <p className="text-[0.95rem] text-text-secondary">
            {t("chatsSummary", { today: o.today, active: o.active, total: o.month_total, confirmed: o.month_confirmed, cancelled: o.month_cancelled })}
          </p>
        )}
        <Table>
          <THead>
            <tr>
              <TH>{t("col.when")}</TH>
              <TH>{t("col.phone")}</TH>
              <TH>{t("col.name")}</TH>
              <TH>{t("col.products")}</TH>
              <TH>{t("col.location")}</TH>
              <TH>{t("col.result")}</TH>
            </tr>
          </THead>
          <tbody>
            {overview.isPending && <RowSkeletons asRow rows={3} cols={6} />}
            {o && o.recent.length === 0 && <EmptyRow colSpan={6}>{t("noChats")}</EmptyRow>}
            {(o?.recent ?? []).map((c) => (
              <TR key={c.id}>
                <TD className="whitespace-nowrap">{formatDateTime(new Date(c.started_at))}</TD>
                <TD className="whitespace-nowrap tabular-nums">{c.phone_e164}</TD>
                <TD>{c.name ?? "—"}</TD>
                <TD className={cn("max-w-xs text-[0.95rem]", wrapText)}>{c.products.length ? c.products.join(", ") : "—"}</TD>
                <TD className={cn("max-w-xs text-[0.95rem]", wrapText)}>{c.location ?? "—"}</TD>
                <TD>
                  <div className="flex flex-col items-start gap-1">
                    <StatusBadge kind={STATUS_KIND[c.status]} label={t(`status.${c.status}`)} />
                    {c.status === "active" && <span className="text-[0.9rem] text-text-secondary">{t(`step.${c.step}`)}</span>}
                    {c.lead_id && (
                      <Link href={`/leads/${c.lead_id}`} className="text-[0.9rem] text-link underline-offset-4 hover:underline">
                        {t("openLead")}
                      </Link>
                    )}
                  </div>
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </section>
    </section>
  );
}
