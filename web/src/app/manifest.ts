import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kold: cold outreach, warm replies",
    short_name: "Kold",
    description: "Genuine opportunities matched to your resume, and cold outreach you approve email by email.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#05070d",
    theme_color: "#05070d",
    categories: ["productivity", "business"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Home", url: "/home" },
      { name: "Discover", url: "/discover" },
      { name: "Today's emails", url: "/today" },
      { name: "Inbox", url: "/inbox" },
    ],
  };
}
