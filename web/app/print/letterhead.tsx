import { useTranslations } from "next-intl";
import { publicAssetUrl } from "@/lib/supabase/env";
import { getSupabaseServer } from "@/lib/supabase/server";

export interface Clinic {
  name: string;
  legal_name: string | null;
  gstin: string | null;
  address_lines: string[];
  city: string | null;
  state: string | null;
  pincode: string | null;
  phones: string[];
  email: string | null;
  website: string | null;
  logo_path: string | null;
  signatory_label: string;
  terms: Record<string, string[]>;
  state_code: string | null;
  llpin: string | null;
  letterhead_qr_url: string | null;
}

export async function getClinic(): Promise<Clinic | null> {
  const supabase = await getSupabaseServer();
  const { data } = await supabase.from("clinic_settings").select("*").eq("branch_code", "main").maybeSingle();
  return data as Clinic | null;
}

/**
 * Clinic header from Admin → Clinic profile (never hard-coded): logo, name, legal name and address
 * on the left, contacts on the right; on bills a thin line with the legal ids below.
 */
export function Letterhead({ clinic, ids = false }: { clinic: Clinic | null; ids?: boolean }) {
  const logo = publicAssetUrl(clinic?.logo_path);
  const t = useTranslations("printBill");
  const place = [clinic?.city, clinic?.state].filter(Boolean).join(", ");
  const legal = ids
    ? [
        clinic?.gstin && `${t("gstin")}: ${clinic.gstin}`,
        clinic?.gstin && clinic.state_code && `${t("stateCode")}: ${clinic.state_code}`,
        clinic?.llpin && `${t("llpin")}: ${clinic.llpin}`,
      ].filter(Boolean)
    : [];
  return (
    <header className="lh">
      <div className="letterhead">
        <div className="lh-brand">
          {/* eslint-disable-next-line @next/next/no-img-element -- printed logo, no optimisation needed */}
          {logo && <img src={logo} alt="" />}
          <div>
            <h1>{clinic?.name ?? ""}</h1>
            {clinic?.legal_name && clinic.legal_name !== clinic.name && <div className="lh-legal">{clinic.legal_name}</div>}
            {(clinic?.address_lines.length ?? 0) > 0 && <div>{clinic!.address_lines.join(", ")}</div>}
            {(place || clinic?.pincode) && <div>{[place, clinic?.pincode].filter(Boolean).join(" - ")}</div>}
          </div>
        </div>
        <div className="lh-contact">
          {(clinic?.phones.length ?? 0) > 0 && (
            <div className="lh-phones">
              {t("phoneShort")}: {clinic!.phones.join(" · ")}
            </div>
          )}
          {clinic?.email && <div>{clinic.email}</div>}
          {clinic?.website && <div>{clinic.website}</div>}
        </div>
      </div>
      {legal.length > 0 && <div className="lh-ids">{legal.join("   ·   ")}</div>}
    </header>
  );
}

/** The clinic logo, faint behind the page (on every printed page). */
export function Watermark({ clinic }: { clinic: Clinic | null }) {
  const logo = publicAssetUrl(clinic?.logo_path);
  if (!logo) return null;
  return (
    <div className="watermark" aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element -- printed logo, no optimisation needed */}
      <img src={logo} alt="" />
    </div>
  );
}
