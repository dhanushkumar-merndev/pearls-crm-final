"use client";

import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { formatTime } from "@pearl/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";
import { rpc } from "@/lib/rpc";

const MINUTES = 30;

/**
 * The reception screen QR (PLAN.md A2): patients scan it and fill the form on their own
 * phone. It changes every 30 minutes, so a photo of it stops working soon after.
 */
export function QrScreen() {
  const t = useTranslations("qr");
  const [svg, setSvg] = useState("");
  const link = useQuery({
    queryKey: ["self_registration_link"],
    queryFn: () => rpc<{ token: string; expires_at: string }>("create_public_link", { p_kind: "self_registration", p_minutes: MINUTES }),
    // A fresh link a minute before the old one expires.
    refetchInterval: (MINUTES - 1) * 60_000,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  const url = link.data ? `${window.location.origin}/r/${link.data.token}` : "";
  useEffect(() => {
    if (!url) return;
    void QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } }).then(setSvg);
  }, [url]);

  return (
    <Page>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="flex flex-col items-center gap-4">
        {/* Fits a phone: as wide as the screen allows, never more than 20rem. */}
        <Card className="flex w-full max-w-80 flex-col items-center gap-4 bg-qr-paper p-4 text-qr-ink sm:max-w-96 sm:p-8">
          {svg ? (
            // The QR is our own generated SVG (no user input reaches it).
            <div aria-label={t("qrLabel")} role="img" className="aspect-square w-full [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <div className="aspect-square w-full animate-pulse rounded-xl bg-qr-placeholder" aria-hidden />
          )}
          <p className="text-center text-xl font-semibold">{t("scan")}</p>
        </Card>
        {link.data && <p className="text-center text-text-secondary">{t("changesAt", { time: formatTime(new Date(link.data.expires_at)) })}</p>}
        <Button variant="secondary" onClick={() => void link.refetch()} disabled={link.isFetching}>
          <RefreshCw aria-hidden className={link.isFetching ? "animate-spin" : undefined} />
          {t("newCode")}
        </Button>
      </div>
    </Page>
  );
}
