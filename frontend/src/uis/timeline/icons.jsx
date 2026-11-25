// The Timeline UI's icons. Each is drawn on a 24-unit grid with one stroke
// weight and sized in em, so an icon is as big as the text around it and a
// font-size on its parent is all it takes to scale one.

function Svg({ children, fill = "none" }) {
  return (
    <svg
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const dot = (cx, cy, r = 1.7) => <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />;

export const Glyph = {
  Bottle: () => (
    <Svg>
      <path d="M10 2.5h4v3h-4z" />
      <path d="M8.5 5.5h7l1 3.5h-9z" />
      <rect x="7.5" y="9" width="9" height="12.5" rx="2.5" />
      <path d="M10.5 13.5h3" />
    </Svg>
  ),
  BottleOff: () => (
    <Svg>
      <path d="M10 2.5h4v3h-4z" />
      <path d="M8.5 5.5h7l1 3.5h-9z" />
      <rect x="7.5" y="9" width="9" height="12.5" rx="2.5" />
      <path d="M3.5 3.5l17 17" />
    </Svg>
  ),
  Nursing: () => (
    <Svg>
      <path d="M12 20.5s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.8a4.3 4.3 0 0 1 7.5 2.7c0 5.4-7.5 10-7.5 10z" />
    </Svg>
  ),
  Spoon: () => (
    <Svg>
      <path d="M3.5 12h17a8.5 8.5 0 0 1-17 0z" />
      <path d="M9 3.5c-1.2 1.6 1.2 2.4 0 4.5" />
      <path d="M14.5 3.5c-1.2 1.6 1.2 2.4 0 4.5" />
    </Svg>
  ),
  Moon: () => (
    <Svg>
      <path d="M20 14.3A8.2 8.2 0 0 1 9.7 4 8.2 8.2 0 1 0 20 14.3z" />
    </Svg>
  ),
  Sunrise: () => (
    <Svg>
      <path d="M2.5 18.5h19" />
      <path d="M6.5 18.5a5.5 5.5 0 0 1 11 0" />
      <path d="M12 5.5v3" />
      <path d="M4.8 10.8l2 2" />
      <path d="M19.2 10.8l-2 2" />
    </Svg>
  ),
  Sun: () => (
    <Svg>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
    </Svg>
  ),
  Drop: () => (
    <Svg>
      <path d="M12 3c3.6 4.3 6.2 7.4 6.2 10.8a6.2 6.2 0 0 1-12.4 0C5.8 10.4 8.4 7.3 12 3z" />
    </Svg>
  ),
  Tummy: () => (
    <Svg>
      <path d="M2.5 12h4l3-7.5 5 15 3-7.5h4" />
    </Svg>
  ),
  Pump: () => (
    <Svg>
      <path d="M8 3.5c2.1 2.6 3.7 4.5 3.7 6.6a3.7 3.7 0 0 1-7.4 0c0-2.1 1.6-4 3.7-6.6z" />
      <path d="M16.5 11c1.8 2.2 3.2 3.9 3.2 5.7a3.2 3.2 0 0 1-6.4 0c0-1.8 1.4-3.5 3.2-5.7z" />
    </Svg>
  ),
  Temp: () => (
    <Svg>
      <path d="M14 14.6V5a2 2 0 0 0-4 0v9.6a4.2 4.2 0 1 0 4 0z" />
      <path d="M12 9v7" />
    </Svg>
  ),
  Scale: () => (
    <Svg>
      <rect x="3.5" y="4.5" width="17" height="15.5" rx="3.5" />
      <path d="M8.5 9.5a5 5 0 0 1 7 0" />
      <path d="M12 10.5l1.7-2" />
    </Svg>
  ),
  Ruler: () => (
    <Svg>
      <rect x="2.5" y="8" width="19" height="8" rx="1.8" />
      <path d="M6.5 8v3M10.5 8v4M14.5 8v3M18.5 8v4" />
    </Svg>
  ),
  Head: () => (
    <Svg>
      <circle cx="12" cy="12" r="8" />
      <path d="M9.2 14c1.2 1.4 4.4 1.4 5.6 0" />
      {dot(9.3, 10.5, 1)}
      {dot(14.7, 10.5, 1)}
    </Svg>
  ),
  Trend: () => (
    <Svg>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </Svg>
  ),
  Note: () => (
    <Svg>
      <path d="M5 4h14v10.5L13.5 20H5z" />
      <path d="M13.5 20v-5.5H19" />
    </Svg>
  ),
  Pill: () => (
    <Svg>
      <rect x="2.5" y="8" width="19" height="8" rx="4" transform="rotate(-45 12 12)" />
      <path d="M9.2 9.2l5.6 5.6" />
    </Svg>
  ),
  Flag: () => (
    <Svg>
      <path d="M5.5 21V3.5" />
      <path d="M5.5 4.5h12l-2.5 4 2.5 4h-12" />
    </Svg>
  ),
  Timer: () => (
    <Svg>
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 9.5v4l2.5 2" />
      <path d="M9.5 2.5h5" />
    </Svg>
  ),
  Chart: () => (
    <Svg>
      <path d="M5 20V11" />
      <path d="M12 20V4.5" />
      <path d="M19 20v-6" />
    </Svg>
  ),
  Photo: () => (
    <Svg>
      <rect x="3" y="5" width="18" height="14.5" rx="3" />
      <circle cx="9" cy="10.5" r="1.8" />
      <path d="M4.5 18l5-4.5 3.5 3 3-2.5 4 4" />
    </Svg>
  ),
  Book: () => (
    <Svg>
      <path d="M5 4.5h10.5a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z" />
      <path d="M9 9h5.5M9 12.5h3.5" />
    </Svg>
  ),
  Calendar: () => (
    <Svg>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </Svg>
  ),
  Gear: () => (
    <Svg>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Svg>
  ),
  Dots: () => (
    <Svg>
      {dot(5.5, 12)}
      {dot(12, 12)}
      {dot(18.5, 12)}
    </Svg>
  ),
  Plus: () => <Svg><path d="M12 5v14M5 12h14" /></Svg>,
  Minus: () => <Svg><path d="M5 12h14" /></Svg>,
  Check: () => <Svg><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>,
  X: () => <Svg><path d="M6 6l12 12M18 6L6 18" /></Svg>,
  ChevronLeft: () => <Svg><path d="M14.5 5.5L8 12l6.5 6.5" /></Svg>,
  ChevronRight: () => <Svg><path d="M9.5 5.5L16 12l-6.5 6.5" /></Svg>,
  ChevronUp: () => <Svg><path d="M5.5 14.5L12 8l6.5 6.5" /></Svg>,
  ArrowDown: () => <Svg><path d="M12 4.5v15M5.5 13l6.5 6.5 6.5-6.5" /></Svg>,
  Pencil: () => (
    <Svg>
      <path d="M4 20h4L19.5 8.5l-4-4L4 16z" />
      <path d="M13 7l4 4" />
    </Svg>
  ),
  Trash: () => (
    <Svg>
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M6.5 7l1 13h9l1-13" />
    </Svg>
  ),
  Undo: () => (
    <Svg>
      <path d="M8.5 5L4 9.5 8.5 14" />
      <path d="M4 9.5h10.5a5.5 5.5 0 0 1 0 11H11" />
    </Svg>
  ),
  Pause: () => <Svg><path d="M9 5.5v13M15 5.5v13" /></Svg>,
  Play: () => <Svg><path d="M8 5.5l10.5 6.5L8 18.5z" /></Svg>,
};
