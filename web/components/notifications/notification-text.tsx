import { formatDateTime } from "@pearl/shared";
import { getSupabaseBrowser } from "@/lib/supabase/client";

/** One row of public.notifications as the bell and the Notifications page read it (own rows only, RLS). */
export interface Notification {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export const NOTIFICATION_COLUMNS = "id, title, body, link, read_at, created_at";

/** Opening a notification marks it read (only the signed-in person's own; the RPC checks). */
export async function markNotificationRead(id: string) {
  await getSupabaseBrowser().rpc("mark_notifications_read", { p_ids: [id] });
}

/** Title (bold while unread), the detail line and when it came. */
export function NotificationText({ n }: { n: Notification }) {
  return (
    <span className="flex w-full flex-col">
      <span className={n.read_at ? "" : "font-semibold"}>{n.title}</span>
      {n.body && <span className="text-[0.9rem] text-text-secondary">{n.body}</span>}
      <span className="text-[0.9rem] text-text-secondary">{formatDateTime(new Date(n.created_at))}</span>
    </span>
  );
}
