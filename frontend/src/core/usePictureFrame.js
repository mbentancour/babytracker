import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../api";

// The picture-frame screensaver: which photos to show and when to show them.
// It starts from ?slideshow=true, after the configured idle time, or on a
// remote command over the display event stream. It belongs to the device, not
// to any one UI, so the session runs it and every UI gets it for free.
export function usePictureFrame(data, prefs) {
  const slideshowParam = new URLSearchParams(window.location.search).get("slideshow") === "true";
  const [showPictureFrame, setShowPictureFrame] = useState(false);
  const [galleryPhotos, setGalleryPhotos] = useState([]);
  const [slideshowTriggered, setSlideshowTriggered] = useState(false);

  // Picture frame: use refs so the idle timer doesn't get reset by re-renders
  const childIdRef = useRef(data.child?.id);
  childIdRef.current = data.child?.id;
  const startPictureFrameRef = useRef(null);

  // Picture frame prefs ref — so startPictureFrame always reads the latest
  const pfPrefsRef = useRef(prefs.pictureFrame);
  pfPrefsRef.current = prefs.pictureFrame;
  const childrenRef = useRef(data.children);
  childrenRef.current = data.children;

  // Fetches and filters gallery photos using current preferences. Returns the
  // list (possibly empty) without touching state. Shared by start + refresh.
  const fetchGalleryPhotos = useCallback(async () => {
    const pf = pfPrefsRef.current || {};
    const allChildren = childrenRef.current || [];

    let childIds = pf.childIds?.length > 0 ? pf.childIds : allChildren.map((c) => c.id);
    if (childIds.length === 0 && childIdRef.current) childIds = [childIdRef.current];

    const responses = await Promise.all(
      childIds.map((cid) => api.getGallery({ child: cid }).catch(() => ({ results: [] })))
    );
    let allPhotos = [];
    const seen = new Set();
    for (const res of responses) {
      for (const item of res.results || []) {
        const key = `${item.entity_type}-${item.photo}`;
        if (!seen.has(key)) {
          seen.add(key);
          allPhotos.push(item);
        }
      }
    }

    const typeFilter = {
      shared: "showShared", photo: "showPhoto", profile: "showProfile",
      milestone: "showMilestone", weight: "showWeight", height: "showHeight",
      head_circumference: "showHeadCirc", feeding: "showFeeding",
      sleep: "showSleep", tummy_time: "showTummy", diaper: "showDiaper",
      temperature: "showTemp", medication: "showMedication", note: "showNote",
    };

    return allPhotos.filter((p) => {
      const key = typeFilter[p.entity_type];
      if (key === undefined) return true;
      return pf[key] !== false;
    });
  }, []);

  const startPictureFrame = useCallback(async () => {
    try {
      const photos = await fetchGalleryPhotos();
      if (photos.length > 0) {
        setGalleryPhotos(photos);
        setShowPictureFrame(true);
      }
    } catch { /* ignore */ }
  }, [fetchGalleryPhotos]);
  startPictureFrameRef.current = startPictureFrame;

  // New photos arrive via the SSE handler below (msg.new_photo) — no polling.

  // ?slideshow=true — start picture frame as soon as child data is available
  useEffect(() => {
    if (slideshowParam && !slideshowTriggered && data.child?.id) {
      setSlideshowTriggered(true);
      startPictureFrame();
    }
  }, [slideshowParam, slideshowTriggered, data.child?.id, startPictureFrame]);

  // Idle timeout trigger — re-runs when the timeout changes OR when picture
  // frame closes (so we re-arm on a wall-mounted tablet that has no further
  // user activity to trigger the listener-based reset).
  const pictureFrameTimeout = prefs.pictureFrameTimeout;
  useEffect(() => {
    if (!pictureFrameTimeout || pictureFrameTimeout <= 0) return;
    if (showPictureFrame) return; // already showing — no idle timer needed

    let idleTimer;
    const resetTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => startPictureFrame(), pictureFrameTimeout * 60 * 1000);
    };

    const events = ["mousedown", "mousemove", "keydown", "touchstart", "scroll"];
    events.forEach((e) => window.addEventListener(e, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      clearTimeout(idleTimer);
      events.forEach((e) => window.removeEventListener(e, resetTimer));
    };
  }, [pictureFrameTimeout, startPictureFrame, showPictureFrame]);

  // Listen for remote display events via SSE — drives picture frame state
  // and live photo refresh. Device name is stored per browser.
  useEffect(() => {
    const deviceName = localStorage.getItem("babytracker_device_name") || "default";
    const evtSource = new EventSource(`./api/display/events?device=${encodeURIComponent(deviceName)}`);
    let isFirst = true;
    evtSource.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (isFirst) { isFirst = false; return; }

        // Picture frame on/off command
        if (msg.set_picture_frame) {
          if (msg.picture_frame) startPictureFrameRef.current();
          else setShowPictureFrame(false);
        }

        // New photo available — refetch the gallery so any active picture
        // frame slideshow merges it in (PictureFrame.jsx handles the merge).
        if (msg.new_photo) {
          fetchGalleryPhotos()
            .then((photos) => { if (photos.length > 0) setGalleryPhotos(photos); })
            .catch(() => {});
        }
      } catch { /* ignore */ }
    };
    return () => evtSource.close();
  }, [startPictureFrame, fetchGalleryPhotos]);

  const closePictureFrame = useCallback(() => {
    setShowPictureFrame(false);
    // Remove ?slideshow=true from URL so it doesn't restart
    if (slideshowParam) {
      const url = new URL(window.location);
      url.searchParams.delete("slideshow");
      window.history.replaceState({}, "", url);
    }
  }, [slideshowParam]);

  return { showPictureFrame, galleryPhotos, closePictureFrame };
}
