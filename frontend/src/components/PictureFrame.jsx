import { useState, useEffect, useCallback } from "react";

export default function PictureFrame({ photos, childName, onWake }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [fading, setFading] = useState(false);

  // Shuffle on mount
  const [shuffled] = useState(() => {
    const arr = [...photos];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  });

  // Cycle photos every 8 seconds with a crossfade
  useEffect(() => {
    if (shuffled.length <= 1) return;
    const timer = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setCurrentIndex((i) => (i + 1) % shuffled.length);
        setFading(false);
      }, 800);
    }, 8000);
    return () => clearInterval(timer);
  }, [shuffled]);

  // Any interaction wakes the app
  const handleWake = useCallback(() => {
    onWake();
  }, [onWake]);

  const current = shuffled[currentIndex];
  if (!current) return null;

  return (
    <div
      className="picture-frame"
      onClick={handleWake}
      onTouchStart={handleWake}
    >
      <div
        className={`picture-frame-image ${fading ? "picture-frame-fade" : ""}`}
        style={{
          backgroundImage: `url(${current.entity_type === "media" ? `./api/media-scan/${current.photo}` : `./api/media/photos/${current.photo}`})`,
        }}
      />
      <div className="picture-frame-overlay">
        <div className="picture-frame-info">
          <div className="picture-frame-label">{current.label}</div>
          {current.detail && (
            <div className="picture-frame-detail">{current.detail}</div>
          )}
          <div className="picture-frame-date">
            {new Date(current.date + "T00:00:00").toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </div>
        </div>
      </div>
      <div className="picture-frame-hint">Tap anywhere to return</div>
      <div className="picture-frame-counter">
        {currentIndex + 1} / {shuffled.length}
      </div>
    </div>
  );
}
