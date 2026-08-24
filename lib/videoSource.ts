// A video someone added to the room from an external service — mirrors the
// server's RoomVideoSource (see server/signaling.ts), which is the authority
// on all of it. Nothing here streams: every participant embeds the same
// video themselves, and only this record travels, which is what makes the
// room watch the same frame at the same time.
export type VideoSource = {
  id: string;
  kind: "youtube";
  videoId: string;
  addedById: string;
  addedByName: string;
  playing: boolean;
  positionSeconds: number;
  // Shared playback speed. Part of the position arithmetic below, not just a
  // display setting.
  playbackRate: number;
  // Server clock (see videoSourcePosition below).
  updatedAt: number;
};

// Where the video should be *right now*, extrapolated from the last state
// the server broadcast: a playing video's position is a function of time, so
// the room stays in sync without anyone streaming position updates. Uses the
// viewer's own clock against the server's `updatedAt`, so a badly-set local
// clock shows up as a constant offset — hence the guard: a negative elapsed
// time (clock behind the server) is treated as "no time has passed" rather
// than as a rewind.
export function videoSourcePosition(source: VideoSource, now = Date.now()): number {
  if (!source.playing) return source.positionSeconds;
  const elapsed = Math.max(0, (now - source.updatedAt) / 1000);
  // Speed matters here: at 1.5x the video covers 1.5 seconds of itself per
  // second of wall clock, and ignoring that drifts further out the longer it
  // plays. `|| 1` covers a source from a server that predates the field.
  return source.positionSeconds + elapsed * (source.playbackRate || 1);
}

const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

// Client-side twin of the server's parseYouTubeVideoId — used only to tell
// someone their link is wrong before sending it, never as the gate: the
// server parses the URL again and its answer is the one that ends up in
// everyone's iframe.
export function parseYouTubeVideoId(raw: string): string | null {
  const trimmed = raw.trim();
  if (YOUTUBE_VIDEO_ID_RE.test(trimmed)) return trimmed;
  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  let id: string | null = null;
  if (host === "youtu.be") {
    id = url.pathname.split("/")[1] ?? null;
  } else if (
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host === "youtube-nocookie.com"
  ) {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else {
      const [, section, value] = url.pathname.split("/");
      if (section === "embed" || section === "live" || section === "shorts" || section === "v") {
        id = value ?? null;
      }
    }
  }
  return id && YOUTUBE_VIDEO_ID_RE.test(id) ? id : null;
}
