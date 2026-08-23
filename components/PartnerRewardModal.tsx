"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import {
  claimPartnerVideoReward,
  getStoredPartnerVideoProgress,
  setStoredPartnerVideoProgress,
  markPartnerRewardClaimedLocally,
  hasClaimedPartnerRewardLocally,
  hasCompletedPartnerVideoLocally,
  markPartnerVideoCompletedLocally,
} from "@/lib/partner";
import { trackEvent } from "@/lib/analytics";
import { signalingClient } from "@/lib/signalingClient";
import { SpeakerIcon, SpeakerMuteIcon, CheckIcon } from "@/components/icons";

// Belt-and-suspenders alongside the seek guard below: on its own this
// wouldn't stop anything (currentTime already reads high after any hack),
// but combined with the seek guard it closes the "ram playbackRate way up"
// gap — a rate change alone can't make maxTimeRef jump without currentTime
// itself genuinely having played there first.
const REQUIRED_WATCH_FRACTION = 0.98;
// Reapplied on an interval rather than only on a `ratechange` listener — a
// console script setting the rate doesn't have to fire an event it doesn't
// want observed, but it can't stop this from running.
const PLAYBACK_RATE_GUARD_MS = 400;
// How far past the furthest point actually reached (maxTimeRef) a seek is
// allowed to land — covers ordinary float/timeupdate granularity, nowhere
// near enough to skip anything that matters.
const SEEK_TOLERANCE_SECONDS = 0.75;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// The watch-to-earn popup behind a partner ad's "Ganhar X Pontos" button
// (see PartnerCard.tsx). Deliberately has no seek bar at all — the video
// renders with no native `controls`, and the anti-skip tracking below snaps
// any attempt to jump ahead (drag, keyboard, or a console script poking
// video.currentTime/playbackRate directly) back to the furthest point
// actually reached. None of this is airtight against someone determined
// enough at the console — nothing client-side can be — so the real gate is
// server-side: "Receber Recompensa" only ever pays out once per account per
// ad (see server/signaling.ts's POST /partner/:id/claim-reward), regardless
// of what this component believes happened.
export function PartnerRewardModal({
  partnerId,
  videoUrl,
  points,
  buttonLabel,
  buttonUrl,
  onClose,
  onClaimed,
}: {
  partnerId: string;
  videoUrl: string;
  points: number;
  buttonLabel: string;
  buttonUrl: string;
  onClose: () => void;
  // Lets the caller (PartnerCard) know a claim went through, so it can hide
  // the "Ganhar X Pontos" button without waiting for a remount.
  onClaimed?: () => void;
}) {
  const { account, refresh } = useAuth();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // The furthest point genuinely reached via real playback — not React
  // state, since it has to be read/written synchronously from inside media
  // event handlers that fire many times a second.
  const maxTimeRef = useRef(0);
  const resumedRef = useRef(false);
  // Guards the server-side "watched it fully" report (see handleEnded) so a
  // replay after already unlocking doesn't count as a second completion —
  // unlike the client-only trackEvent() call next to it, this one moves an
  // admin-panel number.
  const completedReportedRef = useRef(false);

  // Read once, at mount: reopening the popup after having already watched
  // the video through to the end (even without claiming — see handleEnded)
  // should land already unlocked, with the rewatch button showing, instead
  // of forcing a full rewatch just to reach "Receber Recompensa" again.
  const [previouslyCompleted] = useState(() => hasCompletedPartnerVideoLocally(partnerId));
  const [unlocked, setUnlocked] = useState(previouslyCompleted);
  const [claiming, setClaiming] = useState(false);
  // True only for a claim that just succeeded *in this popup session* — kept
  // apart from alreadyClaimed below so the two can read differently ("✓ just
  // received" vs. "you already have these"), even though both end up
  // meaning the same thing to handleClaim's guard.
  const [claimed, setClaimed] = useState(false);
  // Read once, at mount: this popup is reopenable at any time to rewatch the
  // video (see PartnerCard's "Assistir de novo"), but the reward itself is
  // one-time — this is what tells that rewatch not to even attempt another
  // claim, rather than relying on the server's 409 every time.
  const [alreadyClaimed] = useState(() => hasClaimedPartnerRewardLocally(partnerId));
  const [claimError, setClaimError] = useState<string | null>(null);
  const [needsManualPlay, setNeedsManualPlay] = useState(false);
  const [muted, setMuted] = useState(false);
  // Visual only — read from the native play/pause/ended events, purely to
  // show an overlay; nothing security-relevant hangs off these two.
  const [isPaused, setIsPaused] = useState(false);
  const [hasEnded, setHasEnded] = useState(previouslyCompleted);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Giant popup: nobody should be able to scroll the room behind it while
  // it's open.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const video = videoRef.current;
      if (video && video.playbackRate !== 1) video.playbackRate = 1;
    }, PLAYBACK_RATE_GUARD_MS);
    return () => clearInterval(id);
  }, []);

  function attemptPlay() {
    const video = videoRef.current;
    if (!video) return;
    video
      .play()
      .then(() => setNeedsManualPlay(false))
      .catch(() => setNeedsManualPlay(true));
  }

  // Autoplay, attempted right after the popup mounts — a browser that blocks
  // it (no user gesture landed directly on the video element itself) falls
  // back to the manual "Reproduzir vídeo" button below instead of silently
  // sitting on a frozen frame. Skipped entirely when reopening an already-
  // fully-watched video: it opens straight into the "ended" state (rewatch
  // button + unlocked claim button) rather than playing again unasked.
  useEffect(() => {
    if (!previouslyCompleted) attemptPlay();
  }, [previouslyCompleted]);

  // One report per popup open, regardless of whether the video ever plays
  // through — this is the admin panel's "quantos Apertos pra ver o vídeo".
  useEffect(() => {
    signalingClient.reportPartnerRewardVideoOpen(partnerId);
  }, [partnerId]);

  function saveProgress() {
    const video = videoRef.current;
    const seconds = video ? Math.max(video.currentTime, maxTimeRef.current) : maxTimeRef.current;
    setStoredPartnerVideoProgress(partnerId, seconds);
  }

  function handleClose() {
    saveProgress();
    onClose();
  }

  function handleLoadedMetadata() {
    const video = videoRef.current;
    if (!video) return;
    setDuration(video.duration);
    if (resumedRef.current || previouslyCompleted) return;
    resumedRef.current = true;
    const stored = getStoredPartnerVideoProgress(partnerId);
    // Never resumes onto/past the very end — that would let a stale stored
    // value skip straight to "ended" without a single frame having played
    // this session.
    if (stored > 0 && stored < video.duration - 1) {
      video.currentTime = stored;
      maxTimeRef.current = stored;
      setCurrentTime(stored);
    }
  }

  function handleTimeUpdate() {
    const video = videoRef.current;
    if (!video) return;
    setCurrentTime(video.currentTime);
    if (video.currentTime > maxTimeRef.current) {
      maxTimeRef.current = video.currentTime;
    }
  }

  // Fires the instant a seek begins (drag, keyboard, or
  // `video.currentTime = x` from anywhere, console included) — snapping back
  // immediately is what makes "no way to skip ahead" true instead of just
  // "no visible seek bar."
  function handleSeeking() {
    const video = videoRef.current;
    if (video && video.currentTime > maxTimeRef.current + SEEK_TOLERANCE_SECONDS) {
      video.currentTime = maxTimeRef.current;
    }
  }

  // Native `ended` always shows the rewatch overlay, regardless of whether
  // the watch-fraction check below actually unlocks the reward — reaching
  // the end and earning the reward are related but distinct: the overlay is
  // about what the video did, the unlock is about what counts.
  function handleEnded() {
    setHasEnded(true);
    const video = videoRef.current;
    const videoDuration = video?.duration ?? 0;
    if (videoDuration > 0 && maxTimeRef.current >= videoDuration * REQUIRED_WATCH_FRACTION) {
      setUnlocked(true);
      setStoredPartnerVideoProgress(partnerId, videoDuration);
      markPartnerVideoCompletedLocally(partnerId);
      trackEvent("partner_reward_video_completed", { partnerId });
      if (!completedReportedRef.current) {
        completedReportedRef.current = true;
        signalingClient.reportPartnerRewardVideoCompleted(partnerId);
      }
    }
  }

  function togglePlayPause() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) attemptPlay();
    else video.pause();
  }

  // Visual state only (see isPaused's doc comment above). `ended` fires a
  // native `pause` right before it, but the render below checks `hasEnded`
  // first, so that moment shows the rewatch overlay, not this one.
  function handlePause() {
    setIsPaused(true);
  }

  function handlePlay() {
    setIsPaused(false);
    setHasEnded(false);
  }

  // The overlay shown once the video has ended (see the render below) — a
  // native video.play() call already auto-rewinds to the start once
  // currentTime has reached the end (per spec), but currentTime is set
  // explicitly here too so this works the same way even for a reopened popup
  // that skipped straight to "ended" without ever setting it this session.
  function handleRewatch() {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    setCurrentTime(0);
    setHasEnded(false);
    trackEvent("partner_reward_video_rewatch", { partnerId });
    attemptPlay();
  }

  async function handleClaim() {
    if (!unlocked || claiming || claimed || alreadyClaimed) return;
    setClaiming(true);
    setClaimError(null);
    try {
      await claimPartnerVideoReward(partnerId);
      markPartnerRewardClaimedLocally(partnerId);
      setClaimed(true);
      trackEvent("partner_reward_claimed", { partnerId });
      onClaimed?.();
      // Re-resolves /auth/me so the new total shows up wherever the account
      // is displayed (e.g. WatchRoom's header) without a reload.
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha ao resgatar a recompensa.";
      setClaimError(message);
      // The server refuses a repeat claim with this same message whether it
      // was this browser or another session that collected it first —
      // either way there's nothing left here to unlock.
      if (message.includes("já resgatou")) {
        markPartnerRewardClaimedLocally(partnerId);
        setClaimed(true);
      }
    } finally {
      setClaiming(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black p-2 sm:p-6"
      // No backdrop click and no Escape handler on purpose — the corner
      // button below is deliberately the only way out of this popup.
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="relative flex h-full w-full max-w-5xl flex-col items-center justify-center gap-4">
        <button
          type="button"
          onClick={handleClose}
          aria-label="Sair do vídeo"
          className="absolute right-0 top-0 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-2xl leading-none text-white transition hover:bg-black/80"
        >
          ×
        </button>

        <div className="relative flex w-full flex-1 items-center justify-center overflow-hidden rounded-lg bg-black">
          <video
            ref={videoRef}
            src={videoUrl}
            muted={muted}
            playsInline
            disablePictureInPicture
            onContextMenu={(e) => e.preventDefault()}
            onClick={togglePlayPause}
            onPlay={handlePlay}
            onPause={handlePause}
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            onSeeking={handleSeeking}
            onEnded={handleEnded}
            className="max-h-full max-w-full cursor-pointer"
          />

          {/* One overlay at a time, in priority order: the video having
              actually ended outranks a mid-playback pause, which outranks
              the very first autoplay-blocked state. */}
          {hasEnded ? (
            <button
              type="button"
              onClick={handleRewatch}
              className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60 text-lg font-semibold text-white"
            >
              <span className="text-3xl leading-none">↻</span>
              Rever vídeo
            </button>
          ) : needsManualPlay ? (
            <button
              type="button"
              onClick={attemptPlay}
              className="absolute inset-0 flex items-center justify-center bg-black/50 text-lg font-semibold text-white"
            >
              ▶ Reproduzir vídeo
            </button>
          ) : (
            isPaused && (
              // Purely visual — clicking anywhere on the video itself (this
              // overlay included) already resumes it via togglePlayPause.
              <button
                type="button"
                onClick={togglePlayPause}
                aria-label="Continuar vídeo"
                className="absolute inset-0 flex items-center justify-center bg-black/30"
              >
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/50 text-3xl leading-none text-white">
                  ▶
                </span>
              </button>
            )
          )}

          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? "Ativar som" : "Silenciar"}
            className="absolute bottom-3 left-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80"
          >
            {muted ? <SpeakerMuteIcon className="h-4 w-4" /> : <SpeakerIcon className="h-4 w-4" />}
          </button>

          <span className="absolute bottom-3 right-3 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          {/* Visual only, on purpose — a plain filled bar, not a native
              range/progress control, so there's nothing here to drag or
              click to seek. See the module doc comment for why skipping
              ahead isn't offered anywhere in this popup. */}
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
            <div
              className="h-full bg-emerald-500"
              style={{ width: duration > 0 ? `${Math.min(100, (currentTime / duration) * 100)}%` : "0%" }}
            />
          </div>
        </div>

        <div className="flex w-full max-w-md flex-col gap-2 sm:flex-row">
          <a
            href={buttonUrl}
            target="_blank"
            rel="noopener noreferrer"
            // Same click reported by PartnerCard's own CTA — this is the
            // same button (label + link), just also reachable from inside
            // the reward popup, so it counts toward the same "Cliques" stat
            // rather than a separate number the admin panel has to add up.
            onClick={() => signalingClient.reportPartnerClick(partnerId)}
            className="flex-1 rounded-lg border border-white/30 px-4 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-white/10"
          >
            {buttonLabel}
          </a>
          <button
            type="button"
            onClick={handleClaim}
            disabled={!unlocked || claiming || claimed || alreadyClaimed}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
          >
            {claimed ? (
              <>
                <CheckIcon className="h-4 w-4 shrink-0" />
                {points} pontos recebidos
              </>
            ) : alreadyClaimed ? (
              <>
                <CheckIcon className="h-4 w-4 shrink-0" />
                Você já resgatou essa recompensa
              </>
            ) : claiming ? (
              "Recebendo..."
            ) : unlocked ? (
              "Receber Recompensa"
            ) : (
              "Assista até o fim para liberar"
            )}
          </button>
        </div>
        {!account && !claimed && !alreadyClaimed && (
          <p className="text-center text-xs text-amber-400">
            Crie uma conta ou entre em uma para poder receber os pontos.
          </p>
        )}
        {claimError && !claimed && !alreadyClaimed && (
          <p className="text-center text-xs text-red-400">{claimError}</p>
        )}
      </div>
    </div>
  );
}
