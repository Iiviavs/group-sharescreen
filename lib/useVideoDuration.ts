"use client";

import { useEffect, useState } from "react";

// Duration badge on a reward button ("30s", "1:30"). Seconds-only below a
// minute because that's the shape of every ad video in practice, and "30s"
// reads as "this is quick" in a way "0:30" doesn't.
export function formatVideoDuration(seconds: number): string {
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * How long the video at `url` runs, already formatted — null until that's
 * known, so a caller renders no badge rather than a placeholder that later
 * jumps.
 *
 * Reads the length off the file itself: an ad carries a video URL and a
 * points value, never a duration, and asking the admin to type one in is a
 * number that can silently disagree with the video. A metadata-only load, so
 * it costs the headers and the moov atom rather than the video. Anything that
 * fails or never resolves simply stays null.
 *
 * The measurement is kept tagged with the url it came from, and only returned
 * while that's still the url being asked about — the ad slot rotates (see
 * PartnerCard) and the admin form's url changes on every keystroke, both long
 * before a probe resolves, and neither should ever show the previous video's
 * duration under the current one's button.
 */
export function useVideoDurationLabel(url: string | null | undefined): string | null {
  const [measured, setMeasured] = useState<{ url: string; seconds: number } | null>(null);

  useEffect(() => {
    if (!url) return;
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    const onLoadedMetadata = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        setMeasured({ url, seconds: video.duration });
      }
    };
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.src = url;
    return () => {
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      // Aborts a metadata request still in flight when the url changes under
      // it — a rotation, or the next keystroke in the admin form.
      video.removeAttribute("src");
      video.load();
    };
  }, [url]);

  return measured && measured.url === url ? formatVideoDuration(measured.seconds) : null;
}
