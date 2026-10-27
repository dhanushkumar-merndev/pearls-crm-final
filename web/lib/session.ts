import { notFound } from "next/navigation";
import { cache } from "react";
import type { StaffRole, ThemePreference } from "@pearl/shared";
import { getSupabaseServer } from "./supabase/server";

export interface Me {
  id: string;
  role: StaffRole;
  full_name: string;
  username: string | null;
  email: string | null;
  avatar_path: string | null;
  theme: ThemePreference;
  clinic: { name: string | null; logo_path: string | null };
}

/** The signed-in staff member, or null (not logged in, inactive, or no staff row). */
export const getMe = cache(async (): Promise<Me | null> => {
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.rpc("me");
  if (error || !data) return null;
  return data as Me;
});

/** The front desk's pages (patients, bills, appointments, …): reception and admin. */
export const DESK_ROLES: readonly StaffRole[] = ["receptionist", "admin"];

/**
 * For a layout: the page exists only for [roles]; anyone else gets "This page doesn't exist".
 * The database refuses their data anyway; this keeps them from an empty, broken page.
 */
export async function onlyFor(roles: readonly StaffRole[]): Promise<Me> {
  const me = await getMe();
  if (!me || !roles.includes(me.role)) notFound();
  return me;
}

/** Whether there is a login session at all (even if the staff row is inactive). */
export const hasSession = cache(async (): Promise<boolean> => {
  const supabase = await getSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  return Boolean(data?.claims);
});

export interface Branding {
  name: string | null;
  logo_path: string | null;
}

export const getBranding = cache(async (): Promise<Branding> => {
  try {
    const supabase = await getSupabaseServer();
    const { data } = await supabase.rpc("public_branding");
    return { name: data?.name ?? null, logo_path: data?.logo_path ?? null };
  } catch {
    return { name: null, logo_path: null };
  }
});

export const getIdleLogoutMinutes = cache(async (): Promise<number> => {
  const supabase = await getSupabaseServer();
  const { data } = await supabase.from("app_settings").select("value").eq("section", "security").maybeSingle();
  const minutes = Number((data?.value as { idle_logout_minutes?: number } | undefined)?.idle_logout_minutes);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : 15;
});
