"use client";

import { useEffect } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";

const MAX_PER_PAGE_LOAD = 10;

/** Sends browser crashes to client_errors (admin can see them). Silent if logged out. */
export function reportClientError(message: string, stack?: string) {
  try {
    void getSupabaseBrowser()
      .rpc("report_client_error", {
        p_app: "web",
        p_message: message.slice(0, 2000),
        p_stack: stack?.slice(0, 8000) ?? null,
        p_context: { path: window.location.pathname },
      })
      .then(() => undefined);
  } catch {
    // never let error reporting itself break the page
  }
}

export function ClientErrorReporter() {
  useEffect(() => {
    let sent = 0;
    const send = (message: string, stack?: string) => {
      if (sent++ < MAX_PER_PAGE_LOAD) reportClientError(message, stack);
    };
    const onError = (e: ErrorEvent) => send(e.message, e.error?.stack);
    const onRejection = (e: PromiseRejectionEvent) =>
      send(String(e.reason?.message ?? e.reason), e.reason?.stack);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
