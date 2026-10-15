// Writes public/manifest.webmanifest for the current build (full app at "/", Lite at "/kold/app").
import { writeFileSync } from "node:fs";

const STATIC = process.env.KOLD_STATIC === "1";
const base = process.env.KOLD_BASE_PATH ?? (STATIC ? "/kold/app" : "");
const manifest = {
  name: "Kold: cold outreach, warm replies",
  short_name: "Kold",
  description: "Genuine opportunities matched to your resume, and cold outreach you approve email by email.",
  id: `${base}/`,
  start_url: `${base}/`,
  scope: `${base}/`,
  display: "standalone",
  orientation: "portrait",
  background_color: "#05070d",
  theme_color: "#05070d",
  categories: ["productivity", "business"],
  icons: [
    { src: `${base}/icons/icon-192.png`, sizes: "192x192", type: "image/png" },
    { src: `${base}/icons/icon-512.png`, sizes: "512x512", type: "image/png" },
    { src: `${base}/icons/icon-maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
  shortcuts: [
    { name: "Home", url: `${base}/home/` },
    { name: "Discover", url: `${base}/discover/` },
    { name: "Today's emails", url: `${base}/today/` },
    { name: "Inbox", url: `${base}/inbox/` },
  ],
};
writeFileSync(new URL("../public/manifest.webmanifest", import.meta.url), JSON.stringify(manifest, null, 2));
console.log(`manifest written for base "${base || "/"}"`);
