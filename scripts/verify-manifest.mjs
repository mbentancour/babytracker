#!/usr/bin/env node
/**
 * Verify PWA manifest and service worker generation outputs.
 *
 * Usage: node scripts/verify-manifest.mjs <dist-dir>
 *
 * Validates:
 *   1. manifest.webmanifest exists and is valid JSON
 *   2. Required PWA fields: name, short_name, start_url, display, icons
 *   3. Icon entries: 192x192, 512x512, 512x512-maskable
 *   4. Service worker (sw.js) exists
 *   5. registerSW.js exists
 *   6. index.html links the manifest and includes registerSW
 */

import { readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

const distDir = process.argv[2];
if (!distDir) {
  console.error("Usage: node scripts/verify-manifest.mjs <dist-dir>");
  process.exit(1);
}

const errors = [];
const warnings = [];
const checks = [];

function check(name, condition, detail = "") {
  if (condition) {
    checks.push({ name, pass: true });
    console.log(`  ✅ ${name}`);
  } else {
    errors.push({ name, detail });
    checks.push({ name, pass: false });
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`\n🔍 Verifying PWA build artifacts in: ${distDir}\n`);

// 1. Check manifest.webmanifest
const manifestPath = join(distDir, "manifest.webmanifest");
check("manifest.webmanifest exists", existsSync(manifestPath));

let manifest = null;
if (existsSync(manifestPath)) {
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    check("manifest is valid JSON", true);
  } catch {
    errors.push({ name: "manifest is valid JSON", detail: "Invalid JSON" });
    checks.push({ name: "manifest is valid JSON", pass: false });
  }
}

// 2. Required PWA fields
if (manifest) {
  check("manifest has 'name'", typeof manifest.name === "string" && manifest.name.length > 0, manifest.name);
  check("manifest has 'short_name'", typeof manifest.short_name === "string" && manifest.short_name.length > 0, manifest.short_name);
  check("manifest has 'start_url'", typeof manifest.start_url === "string", manifest.start_url);
  check("manifest has 'display' == 'standalone'", manifest.display === "standalone", manifest.display);
  check("manifest has 'theme_color'", typeof manifest.theme_color === "string", manifest.theme_color);
  check("manifest has 'background_color'", typeof manifest.background_color === "string", manifest.background_color);
  check("manifest has 'description'", typeof manifest.description === "string" && manifest.description.length > 0, manifest.description);
}

// 3. Icon entries
if (manifest && manifest.icons) {
  check("manifest has 'icons' array", Array.isArray(manifest.icons), `${manifest.icons?.length} items`);

  const iconSrcs = (manifest.icons || []).map(i => i.src);
  check("manifest has icon-192x192.png", iconSrcs.includes("icons/icon-192x192.png"));
  check("manifest has icon-512x512.png", iconSrcs.includes("icons/icon-512x512.png"));
  check("manifest has icon-512x512-maskable.png", iconSrcs.includes("icons/icon-512x512-maskable.png"));

  // Validate icon object structure
  const requiredIconFields = ["src", "sizes", "type"];
  const iconsValid = manifest.icons.every(icon =>
    requiredIconFields.every(f => icon[f])
  );
  check("all icon entries have src/sizes/type", iconsValid);

  // Check maskable has purpose field
  const maskable = manifest.icons.find(i => i.src === "icons/icon-512x512-maskable.png");
  if (maskable) {
    check("maskable icon has 'purpose' field", maskable.purpose === "any maskable" || maskable.purpose === "maskable", maskable.purpose);
  }
}

// 4. Service worker
check("sw.js exists", existsSync(join(distDir, "sw.js")));

// 5. registerSW.js
check("registerSW.js exists", existsSync(join(distDir, "registerSW.js")));

// 6. index.html references
const indexPath = join(distDir, "index.html");
check("index.html exists", existsSync(indexPath));

if (existsSync(indexPath)) {
  const html = readFileSync(indexPath, "utf-8");
  check("index.html links manifest.webmanifest", html.includes("manifest.webmanifest") || html.includes('link.*rel="manifest"'));
  check("index.html includes registerSW", html.includes("registerSW") || html.includes("register-service-worker"));
}

// Summary
console.log(`\n📊 Results: ${checks.filter(c => c.pass).length}/${checks.length} checks passed`);

if (errors.length > 0) {
  console.log(`\n❌ ${errors.length} error(s):`);
  for (const e of errors) {
    console.log(`   - ${e.name}${e.detail ? `: ${e.detail}` : ""}`);
  }
  console.log("");
  process.exit(1);
} else if (warnings.length > 0) {
  console.log(`\n⚠️ ${warnings.length} warning(s):`);
  for (const w of warnings) {
    console.log(`   - ${w}`);
  }
} else {
  console.log("\n✅ All checks passed — manifest and service worker are valid.\n");
}
process.exit(0);