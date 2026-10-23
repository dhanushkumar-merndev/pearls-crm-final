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

/** Clinic header from Admin → Clinic profile (never hard-coded). */
export function Letterhead({ clinic }: { clinic: Clinic | null }) {
  const logo = publicAssetUrl(clinic?.logo_path);
  return (
    <div className="letterhead">
      {/* eslint-disable-next-line @next/next/no-img-element -- printed logo, no optimisation needed */}
      {logo && <img src={logo} alt="" />}
      <div>
        <h1>{clinic?.name ?? ""}</h1>
        <div className="muted">
          {[...(clinic?.address_lines ?? []), [clinic?.city, clinic?.pincode].filter(Boolean).join(" - ")].filter(Boolean).join(", ")}
        </div>
        <div className="muted">{[clinic?.phones.join(", "), clinic?.email, clinic?.website].filter(Boolean).join(" · ")}</div>
      </div>
    </div>
  );
}
