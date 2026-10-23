"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Pencil, Plus, Power, Save, Search, UserCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { isValidUsername, normalizePhone, normalizeUsername, STAFF_ROLES, type StaffRole } from "@pearl/shared";
import { useDebounced } from "@/components/library-combobox";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Field, PageHeader, Select, Textarea } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Pager } from "@/components/ui/pager";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyRow, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { isStrongEnough } from "@/lib/password";
import { callFunction, unwrap } from "@/lib/rpc";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { useFeedback } from "@/lib/use-feedback";

interface StaffRow {
  id: string;
  full_name: string;
  role: StaffRole;
  username: string | null;
  email: string | null;
  phone_e164: string | null;
  active: boolean;
  bdm_start_anywhere: boolean;
}

type Dialogs = { kind: "create" } | { kind: "edit" | "password" | "deactivate"; row: StaffRow } | null;
const LIMIT = 25;

export function UsersScreen({ myId }: { myId: string }) {
  const t = useTranslations("users");
  const c = useTranslations("common");
  const r = useTranslations("roles");
  const { saved, failed } = useFeedback();
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const search = useDebounced(q.trim());

  const list = useQuery({
    queryKey: ["staff", search, offset],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let query = getSupabaseBrowser()
        .from("staff")
        .select("id, full_name, role, username, email, phone_e164, active, bdm_start_anywhere", { count: "exact" });
      if (search) query = query.ilike("full_name", `%${search.replace(/[%_\\]/g, (x) => `\\${x}`)}%`);
      const { data, error, count } = await query.order("active", { ascending: false }).order("full_name").range(offset, offset + LIMIT - 1);
      return { rows: unwrap({ data, error }) as StaffRow[], total: count ?? 0 };
    },
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["staff"] });
  const reactivate = useMutation({
    mutationFn: (row: StaffRow) => callFunction("admin-users", { action: "reactivate", staff_id: row.id }),
    onSuccess: () => {
      saved(t("reactivated"));
      refresh();
    },
    onError: failed,
  });

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button onClick={() => setDialog({ kind: "create" })}>
            <Plus aria-hidden />
            {t("add")}
          </Button>
        }
      />
      <div className="relative mb-4 max-w-md">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-11"
          value={q}
          aria-label={t("search")}
          placeholder={t("search")}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
        />
      </div>
      <Table>
        <THead>
          <tr>
            <TH>{t("name")}</TH>
            <TH>{t("role")}</TH>
            <TH>{t("username")}</TH>
            <TH>{c("status")}</TH>
            <TH className="text-right">
              <span className="sr-only">{c("actions")}</span>
            </TH>
          </tr>
        </THead>
        <tbody>
          {list.isPending && <EmptyRow colSpan={5}>{c("loading")}</EmptyRow>}
          {list.data?.rows.length === 0 && <EmptyRow colSpan={5}>{c("noMatches")}</EmptyRow>}
          {list.data?.rows.map((row) => (
            <TR key={row.id}>
              <TD>{row.full_name}</TD>
              <TD>{r(row.role)}</TD>
              <TD className="break-all">{row.username ?? "—"}</TD>
              <TD>{row.active ? <StatusBadge kind="good" label={c("active")} /> : <StatusBadge kind="serious" label={t("deactivated")} />}</TD>
              <TD className="text-right whitespace-nowrap">
                <Button variant="ghost" onClick={() => setDialog({ kind: "edit", row })}>
                  <Pencil aria-hidden />
                  {c("edit")}
                </Button>
                <Button variant="ghost" onClick={() => setDialog({ kind: "password", row })}>
                  <KeyRound aria-hidden />
                  {t("password")}
                </Button>
                {row.id !== myId &&
                  (row.active ? (
                    <Button variant="ghost" onClick={() => setDialog({ kind: "deactivate", row })}>
                      <Power aria-hidden />
                      {t("deactivate")}
                    </Button>
                  ) : (
                    <Button variant="ghost" disabled={reactivate.isPending} onClick={() => reactivate.mutate(row)}>
                      <UserCheck aria-hidden />
                      {t("reactivate")}
                    </Button>
                  ))}
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
      {list.data && <Pager offset={offset} limit={LIMIT} total={list.data.total} onOffset={setOffset} />}

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        {dialog?.kind === "create" && <CreateDialog onDone={() => (setDialog(null), refresh())} />}
        {dialog?.kind === "edit" && <EditDialog row={dialog.row} isMe={dialog.row.id === myId} onDone={() => (setDialog(null), refresh())} />}
        {dialog?.kind === "password" && <PasswordDialog row={dialog.row} onDone={() => setDialog(null)} />}
        {dialog?.kind === "deactivate" && <DeactivateDialog row={dialog.row} onDone={() => (setDialog(null), refresh())} />}
      </Dialog>
    </div>
  );
}

function RoleSelect({ value, onChange, a }: { value: StaffRole; onChange: (r: StaffRole) => void; a: object }) {
  const r = useTranslations("roles");
  return (
    <Select {...a} value={value} onChange={(e) => onChange(e.target.value as StaffRole)}>
      {STAFF_ROLES.map((role) => (
        <option key={role} value={role}>
          {r(role)}
        </option>
      ))}
    </Select>
  );
}

function CreateDialog({ onDone }: { onDone: () => void }) {
  const t = useTranslations("users");
  const c = useTranslations("common");
  const { saved, failed } = useFeedback();
  const [form, setForm] = useState({ full_name: "", role: "receptionist" as StaffRole, username: "", email: "", phone: "", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: () => {
      const phone = form.phone.trim() ? normalizePhone(form.phone) : null;
      return callFunction("admin-users", {
        action: "create",
        full_name: form.full_name.trim(),
        role: form.role,
        username: normalizeUsername(form.username),
        ...(form.email.trim() ? { email: form.email.trim().toLowerCase() } : {}),
        ...(phone ? { phone_e164: phone.e164 } : {}),
        password: form.password,
      });
    },
    onSuccess: () => {
      saved(t("created"));
      onDone();
    },
    onError: failed,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!form.full_name.trim()) next.full_name = c("required");
    if (!isValidUsername(form.username)) next.username = t("badUsername");
    if (form.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) next.email = t("badEmail");
    if (form.phone.trim() && !normalizePhone(form.phone)) next.phone = t("badPhone");
    if (!isStrongEnough(form.password)) next.password = t("weakPassword");
    setErrors(next);
    if (Object.keys(next).length === 0) create.mutate();
  }

  return (
    <DialogContent
      title={t("add")}
      description={t("addHint")}
      footer={
        <Button type="submit" form="create-staff" disabled={create.isPending}>
          <Save aria-hidden />
          {create.isPending ? c("saving") : t("create")}
        </Button>
      }
    >
      <form id="create-staff" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label={t("name")} error={errors.full_name}>
          {(a) => <Input {...a} autoComplete="off" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />}
        </Field>
        <Field label={t("role")}>{(a) => <RoleSelect a={a} value={form.role} onChange={(role) => setForm({ ...form, role })} />}</Field>
        <Field label={t("username")} hint={t("usernameHint")} error={errors.username}>
          {(a) => (
            <Input {...a} autoComplete="off" autoCapitalize="none" spellCheck={false} value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })} />
          )}
        </Field>
        <Field label={t("phone")} error={errors.phone}>
          {(a) => <Input {...a} type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />}
        </Field>
        <Field label={t("contactEmail")} hint={t("contactEmailHint")} error={errors.email}>
          {(a) => <Input {...a} type="email" autoComplete="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}
        </Field>
        <Field label={t("firstPassword")} hint={t("passwordRules")} error={errors.password}>
          {(a) => <Input {...a} type="text" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}
        </Field>
      </form>
    </DialogContent>
  );
}

function EditDialog({ row, isMe, onDone }: { row: StaffRow; isMe: boolean; onDone: () => void }) {
  const t = useTranslations("users");
  const c = useTranslations("common");
  const { saved, failed } = useFeedback();
  const [form, setForm] = useState({
    full_name: row.full_name,
    role: row.role,
    phone: row.phone_e164 ?? "",
    bdm_start_anywhere: row.bdm_start_anywhere,
    reason: "",
  });
  const [error, setError] = useState<string>();
  const update = useMutation({
    mutationFn: () => {
      const phone = form.phone.trim() ? normalizePhone(form.phone) : null;
      return callFunction("admin-users", {
        action: "update",
        staff_id: row.id,
        patch: {
          full_name: form.full_name.trim(),
          ...(isMe ? {} : { role: form.role }),
          phone_e164: phone?.e164 ?? null,
          bdm_start_anywhere: form.bdm_start_anywhere,
        },
        reason: form.reason.trim() || undefined,
      });
    },
    onSuccess: () => {
      saved();
      onDone();
    },
    onError: failed,
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (form.phone.trim() && !normalizePhone(form.phone)) return setError(t("badPhone"));
    update.mutate();
  }
  return (
    <DialogContent
      title={t("edit", { name: row.full_name })}
      footer={
        <Button type="submit" form="edit-staff" disabled={update.isPending}>
          <Save aria-hidden />
          {update.isPending ? c("saving") : c("save")}
        </Button>
      }
    >
      <form id="edit-staff" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label={t("name")}>
          {(a) => <Input {...a} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />}
        </Field>
        <Field label={t("role")} hint={isMe ? t("ownRole") : undefined}>
          {(a) => <RoleSelect a={{ ...a, disabled: isMe }} value={form.role} onChange={(role) => setForm({ ...form, role })} />}
        </Field>
        <Field label={t("phone")} error={error}>
          {(a) => <Input {...a} type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />}
        </Field>
        {form.role === "bdm" && (
          <Checkbox
            label={t("startAnywhere")}
            hint={t("startAnywhereHint")}
            checked={form.bdm_start_anywhere}
            onChange={(e) => setForm({ ...form, bdm_start_anywhere: e.target.checked })}
          />
        )}
        <Field label={t("reason")} hint={t("reasonHint")}>
          {(a) => <Input {...a} maxLength={300} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />}
        </Field>
      </form>
    </DialogContent>
  );
}

function PasswordDialog({ row, onDone }: { row: StaffRow; onDone: () => void }) {
  const t = useTranslations("users");
  const c = useTranslations("common");
  const { saved, failed } = useFeedback();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const set = useMutation({
    mutationFn: () => callFunction("admin-users", { action: "set_password", staff_id: row.id, password }),
    onSuccess: () => {
      saved(t("passwordSet"));
      onDone();
    },
    onError: failed,
  });
  return (
    <DialogContent
      title={t("setPassword", { name: row.full_name })}
      description={t("setPasswordHint")}
      footer={
        <Button type="submit" form="set-password" disabled={set.isPending}>
          <KeyRound aria-hidden />
          {set.isPending ? c("saving") : t("setPasswordButton")}
        </Button>
      }
    >
      <form
        id="set-password"
        onSubmit={(e) => {
          e.preventDefault();
          if (!isStrongEnough(password)) return setError(t("weakPassword"));
          set.mutate();
        }}
        noValidate
      >
        <Field label={t("newPassword")} hint={t("passwordRules")} error={error}>
          {(a) => <Input {...a} type="text" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
      </form>
    </DialogContent>
  );
}

function DeactivateDialog({ row, onDone }: { row: StaffRow; onDone: () => void }) {
  const t = useTranslations("users");
  const { saved, failed } = useFeedback();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const deactivate = useMutation({
    mutationFn: () => callFunction("admin-users", { action: "deactivate", staff_id: row.id, reason: reason.trim() }),
    onSuccess: () => {
      saved(t("deactivated"));
      onDone();
    },
    onError: failed,
  });
  return (
    <DialogContent
      title={t("deactivateWho", { name: row.full_name })}
      description={t("deactivateHint")}
      footer={
        <Button type="submit" variant="danger" form="deactivate" disabled={deactivate.isPending}>
          <Power aria-hidden />
          {t("deactivate")}
        </Button>
      }
    >
      <form
        id="deactivate"
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim().length < 3) return setError(t("reasonNeeded"));
          deactivate.mutate();
        }}
        noValidate
      >
        <Field label={t("reason")} error={error}>
          {(a) => <Textarea {...a} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </form>
    </DialogContent>
  );
}
