/** wa.me link with a ready message (manual WhatsApp until the Cloud API is connected in Phase 10). */
export function waLink(phoneE164: string, text: string): string {
  return `https://wa.me/${phoneE164.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}
