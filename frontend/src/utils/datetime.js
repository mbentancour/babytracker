// toLocalDatetime formats a Date as "YYYY-MM-DDTHH:MM" in the browser's local
// timezone — the shape HTML <input type="datetime-local"> binds to.
export function toLocalDatetime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// localInputToUTC converts a naive "YYYY-MM-DDTHH:MM" string (as produced by
// datetime-local inputs, in the user's local timezone) into a naive UTC
// string "YYYY-MM-DDTHH:MM:SS" suitable for the backend, which parses
// timestamps as UTC via time.Parse without a timezone layout.
//
// Before this helper existed, forms shipped the raw local-time string
// straight through, so a feed logged at 16:00 CET was stored as 16:00 UTC
// and then rendered back as 18:00 CET — an offset-length time-shift bug.
export function localInputToUTC(localStr) {
  if (!localStr) return "";
  // `new Date("YYYY-MM-DDTHH:MM")` parses in local time in every modern browser.
  const d = new Date(localStr.length === 16 ? `${localStr}:00` : localStr);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
