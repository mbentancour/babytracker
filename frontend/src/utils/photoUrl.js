// Server-side resize presets (longest edge in px). Keep in sync with
// thumbnailSizes in internal/handlers/thumbnail.go.
const SIZE_PRESETS = [
  { name: "medium", px: 800 },
  { name: "large", px: 1920 },
];

/**
 * URL for displaying a photo full-screen on this device, honoring the
 * per-device photoQuality preference: "medium"/"large" force that rendition,
 * "original" disables resizing, and "auto" (default) picks the smallest
 * rendition covering the display's physical resolution — so e.g. a 1080p
 * tablet fetches a 1920px JPEG instead of a multi-MB camera original.
 * Auto never requests the original: some tablets/webviews report physical
 * pixels in screen.* *and* a devicePixelRatio above 1, inflating the computed
 * resolution past every preset — auto caps at the largest preset instead.
 */
export function fullscreenPhotoUrl(filename, quality = "auto") {
  if (quality === "original") return `./api/media/photos/${filename}`;
  let preset = SIZE_PRESETS.find((s) => s.name === quality);
  if (!preset) {
    const dpr = window.devicePixelRatio || 1;
    const longestEdge =
      Math.max(window.screen?.width || 0, window.screen?.height || 0) * dpr;
    preset =
      SIZE_PRESETS.find((s) => s.px >= longestEdge && longestEdge > 0) ||
      SIZE_PRESETS[SIZE_PRESETS.length - 1];
  }
  return `./api/media/photos/${filename}?size=${preset.name}`;
}
