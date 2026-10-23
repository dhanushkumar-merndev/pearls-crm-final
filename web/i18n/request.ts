import { getRequestConfig } from "next-intl/server";

// English only for now; Kannada/Hindi later = add messages/kn.json, messages/hi.json.
export default getRequestConfig(async () => {
  const locale = "en";
  return {
    locale,
    timeZone: "Asia/Kolkata",
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
