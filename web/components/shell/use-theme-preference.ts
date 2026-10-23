"use client";

import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef } from "react";
import type { ThemePreference } from "@pearl/shared";
import { getSupabaseBrowser } from "@/lib/supabase/client";

/**
 * The theme is saved on the staff profile, so it follows the person to any PC.
 * On load we apply the saved choice; changing it saves it back.
 */
export function useThemePreference(saved: ThemePreference) {
  const { theme, setTheme } = useTheme();
  const applied = useRef(false);

  useEffect(() => {
    if (applied.current) return;
    applied.current = true;
    if (theme !== saved) setTheme(saved);
  }, [saved, theme, setTheme]);

  const choose = useCallback(
    (next: ThemePreference) => {
      setTheme(next);
      void getSupabaseBrowser().rpc("set_my_theme", { p_theme: next }).then(() => undefined);
    },
    [setTheme],
  );

  return { theme: (theme ?? saved) as ThemePreference, choose };
}
