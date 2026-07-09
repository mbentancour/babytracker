// Server-side resize presets (longest edge in px). Keep in sync with
// thumbnailSizes in internal/handlers/thumbnail.go.
const SIZE_PRESETS = [
  { name: "medium", px: 800 },
  { name: "large", px: 1920 },
];

/**
 * URL for displaying a photo full-screen on this device. Picks the smallest
 * server-side rendition that still covers the display's physical resolution,
 * so e.g. a 1080p tablet fetches a 1920px JPEG instead of a multi-MB camera
 * original. Displays sharper than the largest preset get the original.
 */
export function fullscreenPhotoUrl(filename) {
  const dpr = window.devicePixelRatio || 1;
  const longestEdge =
    Math.max(window.screen?.width || 0, window.screen?.height || 0) * dpr;
  const preset = SIZE_PRESETS.find((s) => s.px >= longestEdge && longestEdge > 0);
  return preset
    ? `./api/media/photos/${filename}?size=${preset.name}`
    : `./api/media/photos/${filename}`;
}
