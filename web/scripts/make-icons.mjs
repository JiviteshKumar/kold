// Renders Kold's app icons (PWA + iOS home screen) from one SVG. Run: node scripts/make-icons.mjs
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const mark = (pad, bg = true) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="64" y2="64">
      <stop offset="0" stop-color="#e0f2fe"/><stop offset="0.5" stop-color="#7dd3fc"/><stop offset="1" stop-color="#a78bfa"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.35" r="0.7">
      <stop offset="0" stop-color="#38bdf8" stop-opacity="0.25"/><stop offset="1" stop-color="#05070d" stop-opacity="0"/>
    </radialGradient>
  </defs>
  ${bg ? '<rect width="512" height="512" fill="#05070d"/><rect width="512" height="512" fill="url(#glow)"/>' : ""}
  <g transform="translate(${pad} ${pad}) scale(${(512 - pad * 2) / 64})" stroke="url(#g)" stroke-width="3.4" stroke-linecap="round" fill="none">
    <path d="M32 12v40"/><path d="M14.7 22l34.6 20"/><path d="M49.3 22L14.7 42"/>
    <path d="M32 12l-4.5 4.5M32 12l4.5 4.5"/><path d="M18 32l14 8 14-8" stroke-width="3.8"/>
  </g>
</svg>`;

const badge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g stroke="#fff" stroke-width="4" stroke-linecap="round" fill="none">
<path d="M32 12v40"/><path d="M14.7 22l34.6 20"/><path d="M49.3 22L14.7 42"/></g></svg>`;

await mkdir("public/icons", { recursive: true });
const out = [
  ["icon-192.png", 192, mark(70)],
  ["icon-512.png", 512, mark(70)],
  ["icon-maskable-512.png", 512, mark(120)],
  ["apple-touch-icon.png", 180, mark(80)],
  ["badge-96.png", 96, badge],
];
for (const [name, size, svg] of out) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(`public/icons/${name}`);
  console.log("wrote", name);
}
