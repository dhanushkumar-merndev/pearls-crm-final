"use client";

import { useTranslations } from "next-intl";

export function PrintToolbar() {
  const t = useTranslations("print");
  return (
    <div className="toolbar">
      <button type="button" onClick={() => window.close()}>
        {t("close")}
      </button>
      <button type="button" onClick={() => window.print()}>
        {t("print")}
      </button>
    </div>
  );
}
