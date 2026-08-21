"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  SpeakerIcon,
  SpeakerMuteIcon,
  PipIcon,
  PipExitIcon,
  FullscreenIcon,
  FullscreenExitIcon,
  EyeIcon,
  EyeOffIcon,
  FocusIcon,
  HyperfocusIcon,
} from "@/components/icons";
import { VolumeSlider } from "@/components/VolumeSlider";
import { MAX_GAIN } from "@/lib/audioGain";
import { useGainedAudio } from "@/lib/useGainedAudio";

function noopSubscribe() {
  return () => {};
}
function getPipSupported() {
  return typeof document !== "undefined" && Boolean(document.pictureInPictureEnabled);
}
function getPipSupportedServer() {
  return false;
}

export function VideoTile({
  stream,
  label,
  accessibleLabel,
  badge,
  muted = false,
  allowUnmute = true,
  volume,
  onVolumeChange,
  fill = false,
  onStopWatching,
  onDoubleClick,
  onRenderedSizeChange,
  onFocus,
  isSpotlighted = false,
  onHyperfocus,
  isHyperfocused = false,
  className = "",
}: {
  stream: MediaStream;
  label: ReactNode;
  // Plain-text version of `label` for aria-label/title attributes, which
  // can't render a component (DisplayUserName) the way `label` itself can.
  // Defaults to a generic phrase when the caller has nothing better.
  accessibleLabel?: string;
  badge?: string;
  // Extra classes for the root tile — e.g. WatchRoom's spotlight grid span.
  className?: string;
  muted?: boolean;
  allowUnmute?: boolean;
  // Up to audioGain.ts's MAX_GAIN (300%) — see useGainedAudio below.
  volume?: number;
  onVolumeChange?: (volume: number) => void;
  // Reports how large this tile is actually drawn, in CSS pixels. The viewer
  // uses it to ask the broadcaster for a matching quality tier (see
  // qualityNegotiation) — in a 30-person grid each tile is ~320px wide, so
  // without this the sender is encoding 1080p and throwing ~95% of those
  // pixels away, on their CPU and their uplink both. Omitted for the local
  // preview, which nobody is sending to us.
  onRenderedSizeChange?: (width: number, height: number) => void;
  // When true (the lone tile in the room), grow to fill the available
  // space instead of staying locked to a 16:9 card like the grid view.
  fill?: boolean;
  // Only passed for remote peers — lets the viewer stop receiving this
  // specific stream (see WatchRoom/useRoomMedia) without affecting anyone
  // else's tile. Omitted for the local "Você" tile, which has nothing to
  // stop watching.
  onStopWatching?: () => void;
  onDoubleClick?: () => void;
  // "Focar": grow this tile and shrink the rest, without touching anyone's
  // connection — see WatchRoom's spotlightId. Omitted where focusing makes
  // no sense (e.g. the admin moderation viewer).
  onFocus?: () => void;
  isSpotlighted?: boolean;
  // "Hiperfoco": grow this tile to near-fullscreen and actively disconnect
  // every other transmission to free up bandwidth/CPU — see WatchRoom's
  // hyperfocusId/enterHyperfocus.
  onHyperfocus?: () => void;
  isHyperfocused?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isMuted, setIsMuted] = useState(muted);
  const [internalVolume, setInternalVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPiP, setIsPiP] = useState(false);
  // Video keeps showing the last frame's black backdrop until the stream
  // actually has data flowing — surface that gap as a spinner instead of a
  // blank black tile, and reset it whenever the stream is swapped out.
  const [isVideoLoading, setIsVideoLoading] = useState(true);
  const pipSupported = useSyncExternalStore(noopSubscribe, getPipSupported, getPipSupportedServer);

  // Resetting the spinner is derived state, not a side effect: it is a pure
  // function of "the stream changed". React's documented pattern for that is
  // to adjust during render, which is also cheaper than the effect version —
  // the effect committed a render with the *old* loading flag and then
  // immediately re-rendered, and in a 30-tile room with people joining and
  // leaving that doubled render happened constantly.
  const [renderedStream, setRenderedStream] = useState(stream);
  if (renderedStream !== stream) {
    setRenderedStream(stream);
    setIsVideoLoading(true);
  }

  // Attaching the stream to the element stays an effect: that genuinely is a
  // side effect on a DOM node.
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  useGainedAudio(videoRef, stream, volume ?? internalVolume, isMuted);

  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  // Watches the <video> itself rather than the container: the container may
  // be letterboxed around a differently-shaped video, and it is the video's
  // own drawn size that decides how many pixels are actually useful.
  // ResizeObserver (not a resize listener) because most size changes here
  // come from layout — the grid reflowing as people join, fullscreen, PiP —
  // and never fire a window resize at all.
  // Held in a ref so callers may pass an inline arrow without tearing down
  // and rebuilding the observer on every single render.
  const sizeCallbackRef = useRef(onRenderedSizeChange);
  useEffect(() => {
    sizeCallbackRef.current = onRenderedSizeChange;
  }, [onRenderedSizeChange]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      sizeCallbackRef.current?.(Math.round(box.width), Math.round(box.height));
    });
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onEnter = () => setIsPiP(true);
    const onLeave = () => setIsPiP(false);
    video.addEventListener("enterpictureinpicture", onEnter);
    video.addEventListener("leavepictureinpicture", onLeave);
    return () => {
      video.removeEventListener("enterpictureinpicture", onEnter);
      video.removeEventListener("leavepictureinpicture", onLeave);
    };
  }, []);

  async function toggleFullscreen() {
    if (!containerRef.current) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await containerRef.current.requestFullscreen();
      }
    } catch {
      // ignored - fullscreen may be blocked by the browser
    }
  }

  async function togglePiP() {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await videoRef.current.requestPictureInPicture();
      }
    } catch {
      // ignored - PiP requires a direct user gesture and may be unsupported
    }
  }

  function handleVolumeChange(nextVolume: number) {
    if (volume === undefined) setInternalVolume(nextVolume);
    onVolumeChange?.(nextVolume);
    setIsMuted(nextVolume === 0);
  }

  const nameForLabel = accessibleLabel ?? "essa transmissão";

  return (
    <div
      ref={containerRef}
      onDoubleClick={onDoubleClick}
      className={`group relative w-full overflow-hidden rounded-xl border border-white/10 bg-black ${
        // No min-height floor here: on a short viewport a fixed floor could
        // force this box taller than the space main actually has, which is
        // exactly what pushed the tile past the bottom of the screen and
        // forced a scroll — h-full alone always stays within whatever main
        // gives it.
        fill ? "h-full" : "aspect-video"
      } ${className}`}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        onLoadedData={() => setIsVideoLoading(false)}
        className="h-full w-full object-contain bg-black"
      />
      {isVideoLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white/80" />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-linear-to-t from-black/85 to-transparent px-3 py-2">
        <span className="truncate text-sm font-medium text-white">{label}</span>
        {badge && (
          <span className="rounded-full bg-red-500/90 px-2 py-0.5 text-xs font-semibold text-white">
            {badge}
          </span>
        )}
      </div>
      {/* Hidden until hovered, so a busy grid isn't wall-to-wall buttons —
          but always shown on a touch device, which has no hover state to
          reveal them with in the first place. */}
      <div className="absolute right-2 top-2 flex flex-wrap items-center justify-end gap-2 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
        {allowUnmute && (
          <VolumeSlider
            value={volume ?? internalVolume}
            label={`Volume da transmissão de ${nameForLabel}`}
            onChange={handleVolumeChange}
            showIcon={false}
            max={MAX_GAIN}
            className="rounded-full bg-black/60 px-2 py-1 text-white"
          />
        )}
        {allowUnmute && (
          <button
            type="button"
            onClick={() => setIsMuted((m) => !m)}
            title={isMuted ? "Ativar som" : "Silenciar"}
            aria-label={isMuted ? "Ativar som" : "Silenciar"}
            className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80 active:bg-black/80"
          >
            {isMuted ? <SpeakerMuteIcon className="h-5 w-5" /> : <SpeakerIcon className="h-5 w-5" />}
          </button>
        )}
        {pipSupported && (
          <button
            type="button"
            onClick={togglePiP}
            title={isPiP ? "Sair do picture-in-picture" : "Picture-in-picture"}
            aria-label={isPiP ? "Sair do picture-in-picture" : "Picture-in-picture"}
            className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80 active:bg-black/80"
          >
            {isPiP ? <PipExitIcon className="h-5 w-5" /> : <PipIcon className="h-5 w-5" />}
          </button>
        )}
        {onFocus && (
          <button
            type="button"
            onClick={onFocus}
            title={isSpotlighted ? "Remover destaque" : `Focar em ${nameForLabel}`}
            aria-label={isSpotlighted ? "Remover destaque" : `Focar em ${nameForLabel}`}
            aria-pressed={isSpotlighted}
            className={`rounded-full p-2 text-white active:bg-black/80 ${
              isSpotlighted ? "bg-emerald-600 hover:bg-emerald-700" : "bg-black/60 hover:bg-black/80"
            }`}
          >
            <FocusIcon className="h-5 w-5" />
          </button>
        )}
        {onHyperfocus && (
          <button
            type="button"
            onClick={onHyperfocus}
            title={`Hiperfoco em ${nameForLabel} — esconde e desconecta as outras transmissões`}
            aria-label={`Hiperfoco em ${nameForLabel}`}
            aria-pressed={isHyperfocused}
            className={`rounded-full p-2 text-white active:bg-black/80 ${
              isHyperfocused ? "bg-emerald-600 hover:bg-emerald-700" : "bg-black/60 hover:bg-black/80"
            }`}
          >
            <HyperfocusIcon className="h-5 w-5" />
          </button>
        )}
        <button
          type="button"
          onClick={toggleFullscreen}
          title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
          aria-label={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
          className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80 active:bg-black/80"
        >
          {isFullscreen ? <FullscreenExitIcon className="h-5 w-5" /> : <FullscreenIcon className="h-5 w-5" />}
        </button>
        {onStopWatching && (
          <button
            type="button"
            onClick={onStopWatching}
            title="Parar de assistir"
            aria-label="Parar de assistir"
            className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80 active:bg-black/80"
          >
            <EyeOffIcon className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  );
}

function PlaceholderTile({
  fill,
  children,
}: {
  fill: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`relative flex w-full flex-col items-center justify-center gap-3 overflow-hidden rounded-xl border border-white/10 bg-black px-4 text-center ${
        // Same reasoning as VideoTile's fill container above: no min-height
        // floor, so this never grows past what main actually has to give.
        fill ? "h-full" : "aspect-video"
      }`}
    >
      {children}
    </div>
  );
}

export function StoppedPeerTile({
  label,
  fill = false,
  onResume,
}: {
  label: ReactNode;
  fill?: boolean;
  onResume: () => void;
}) {
  return (
    <PlaceholderTile fill={fill}>
      <p className="text-sm text-zinc-300">
        Você saiu dessa transmissão
        <br />
        <span className="text-zinc-500">({label})</span>
      </p>
      <button
        type="button"
        onClick={onResume}
        className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-white/20"
      >
        <EyeIcon className="h-5 w-5" />
        Retomar transmissão
      </button>
    </PlaceholderTile>
  );
}

// Shown between the moment resumeWatchingPeer() is called and the moment a
// fresh stream actually arrives — without this, the tile would just vanish
// for that stretch (no tile at all), since it's neither in stoppedPeers
// (cleared immediately) nor in remoteStreams (nothing received yet).
export function ResumingPeerTile({ fill = false }: { fill?: boolean }) {
  return (
    <PlaceholderTile fill={fill}>
      <p className="text-sm text-zinc-400">Retomando...</p>
    </PlaceholderTile>
  );
}
