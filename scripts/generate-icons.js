/**
 * Generate PWA icons from the SVG source using Sharp.
 *
 * Outputs:
 *   public/icons/icon-192x192.png
 *   public/icons/icon-512x512.png
 *   public/icons/icon-512x512-maskable.png  (with padded safe area)
 */

import sharp from "../frontend/node_modules/sharp/lib/index.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outDir = join(root, "public", "icons");
const svgSource = join(root, "scripts", "icon.svg");

const sizes = [192, 512];

// Maskable icon needs 10% padding (safe area = 90% of icon)
const maskablePadding = 0.10;

async function generateIcon(width, outputPath, options = {}) {
  const pipeline = sharp(svgSource)
    .resize(width, width, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png(options);

  await pipeline.toFile(outputPath);
  console.log(`  ✓ ${outputPath.replace(root + "/", "")}  (${width}×${width})`);
}

async function generateMaskableIcon(outputPath) {
  // Generate the base 512 icon first
  const base512 = join(outDir, "icon-512x512.png");
  await generateIcon(512, base512);

  // Then create a maskable version with padding
  // Maskable icons need 10% padding — the icon content must fit within the center 90%
  // Sharp can add padding by resizing to 90% and placing in a padded canvas
  const paddedSize = Math.round(512 * (1 + maskablePadding * 2)); // 512 + 10% padding on each side

  const pipeline = sharp(svgSource)
    .resize(
      Math.round(512 * (1 - maskablePadding * 2)), // content size: ~410px
      Math.round(512 * (1 - maskablePadding * 2)),
      { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }
    )
    .resize(paddedSize, paddedSize, { fit: "contain", background: { r: 108, g: 99, b: 255, alpha: 0 } }) // use theme color as fallback
    .extract({
      left: Math.round((paddedSize - 512) / 2),
      top: Math.round((paddedSize - 512) / 2),
      width: 512,
      height: 512,
    })
    .png();

  await mkdir(outDir, { recursive: true });
  await pipeline.toFile(outputPath);
  console.log(`  ✓ ${outputPath.replace(root + "/", "")}  (512 maskable)`);
}

async function main() {
  console.log("Generating PWA icons...\n");
  await mkdir(outDir, { recursive: true });

  for (const size of sizes) {
    await generateIcon(size, join(outDir, `icon-${size}x${size}.png`));
  }

  await generateMaskableIcon(join(outDir, "icon-512x512-maskable.png"));

  console.log("\nDone! Icons written to public/icons/");
}

main().catch((err) => {
  console.error("Icon generation failed:", err.message);
  process.exit(1);
});