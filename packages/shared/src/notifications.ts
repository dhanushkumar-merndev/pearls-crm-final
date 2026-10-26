/**
 * Every kind of notification the system sends (public.notifications.type), with the default
 * channels when the admin hasn't set a rule (Admin → Notifications). The bell always shows it;
 * push rings the Android app; email goes to the person's address (Brevo).
 */
export const NOTIFICATION_TYPES = {
  registration_pending: { push: true, email: false },
  stock_alert: { push: true, email: false },
  lead_assigned: { push: true, email: false },
  lead_unassigned: { push: true, email: false },
  lead_enquired_again: { push: true, email: false },
  whatsapp_reply: { push: true, email: false },
  recording_sync: { push: true, email: false },
  bdm_alert: { push: true, email: false },
  storage_alert: { push: true, email: true },
  backup_reminder: { push: true, email: true },
  daily_summary: { push: false, email: false },
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;
export const NOTIFICATION_TYPE_LIST = Object.keys(NOTIFICATION_TYPES) as NotificationType[];

/** Sent no matter the rules: the phone acts on it (shares its location). */
export const SYSTEM_NOTIFICATION_TYPES = ["locate_now"] as const;
