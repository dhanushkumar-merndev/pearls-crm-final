import type { MetadataRoute } from "next";
import { colorTokens } from "@pearl/shared";

// "Add to home screen" on phones and computers. The tab icons are app/favicon.ico, icon.png and
// apple-icon.png (Next adds their <link> tags); these are the bigger ones for installing.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Clinic CRM",
    short_name: "Clinic CRM",
    start_url: "/home",
    display: "standalone",
    background_color: colorTokens("dark").page,
    theme_color: colorTokens("dark").page,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
