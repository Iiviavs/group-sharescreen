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
import { BsCoin } from "react-icons/bs";

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

export type PartnerRewardPopupData = {
  partnerId: string;
  videoUrl: string;
  points: number;
  // The ad's own copy, shown in the popup header — whoever opens this is
  // several clicks away from the card by then, and the video alone doesn't
  // say whose ad it is.
  title: string;
  description: string;
  imageUrl?: string | null;
  buttonLabel: string;
  buttonUrl: string;
  // Lets the opener (PartnerCard) know a claim went through, so it can flip
  // its reward button to "Assistir de novo" without waiting for a remount.
  onClaimed?: () => void;
};

// The watch-to-earn popup behind a partner ad's "Receber X" button (see
// PartnerCard.tsx). Not a modal that renders its own backdrop: it's an
// ntpopups popup type, registered as "partner_reward" in NtPopups.tsx and
// opened through that library's `openPopup`, which owns the backdrop, the
// sizing, the animation and the body-scroll lock. That's also what keeps the
// call visible behind it — the backdrop is translucent and the popup is a
// contained (if large) card, rather than the full-bleed black takeover this
// used to be. Everything below the header down is this component's.
//
// Until the video has been watched through, it deliberately has no seek bar
// at all — it renders with no native `controls`, and the anti-skip tracking
// below snaps any attempt to jump ahead (drag, keyboard, or a console script
// poking video.currentTime/playbackRate directly) back to the furthest point
// actually reached. Once it *has* been watched through (`unlocked`), all of
// that is dropped and the native controls take over: the reward is already
// earned at that point, so there's nothing left for the restriction to
// protect, and someone who wants to rewatch a bit should be able to. None of
// this is airtight against someone determined enough at the console —
// nothing client-side can be — so the real gate is server-side: the claim
// only ever pays out once per account per ad (see server/signaling.ts's POST
// /partner/:id/claim-reward), regardless of what this component believes
// happened.
export function PartnerRewardModal({
  closePopup,
  data: {
    partnerId,
    videoUrl,
    points,
    title,
    description,
    imageUrl,
    buttonLabel,
    buttonUrl,
    onClaimed,
  },
}: {
  // Injected by ntpopups. The popup is opened with requireAction, so only
  // closePopup(true) actually closes it — see the × below.
  closePopup: (hasAction?: boolean) => void;
  data: PartnerRewardPopupData;
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
  // should land already unlocked, with the full player showing, instead of
  // forcing a full rewatch just to reach the claim button again.
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
  // Whether a claim has already been attempted without an account (see
  // handleClaim) — the "you need an account" notice below is this *and* still
  // being signed out, so signing in elsewhere in the app (the guest banner
  // behind this popup, another tab) clears it without anything having to
  // watch for that. It used to sit under the buttons from the moment the
  // popup opened, which told a guest they couldn't have something before
  // they'd even watched the thing that earns it — an ad that opens by
  // explaining what you don't get. Now the video plays for everyone, and the
  // notice appears at the one moment it answers something they did.
  const [claimAttemptedSignedOut, setClaimAttemptedSignedOut] = useState(false);
  const [needsManualPlay, setNeedsManualPlay] = useState(false);
  const [muted, setMuted] = useState(false);
  // Visual only — read from the native play/pause/ended events, purely to
  // show an overlay; nothing security-relevant hangs off these two.
  const [isPaused, setIsPaused] = useState(false);
  const [hasEnded, setHasEnded] = useState(previouslyCompleted);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  // Whether the video has reported its metadata yet. Only drives the loading
  // state below — the player area itself holds a fixed 16:9 box either way,
  // so this never changes the popup's size.
  const [videoReady, setVideoReady] = useState(false);
  // A video that will never load (dead URL, unsupported codec) would
  // otherwise spin forever.
  const [loadFailed, setLoadFailed] = useState(false);

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
  // fully-watched video: it opens straight into the "ended" state (full
  // player + unlocked claim button) rather than playing again unasked.
  useEffect(() => {
    if (!previouslyCompleted) attemptPlay();
  }, [previouslyCompleted]);

  // One report per popup open, regardless of whether the video ever plays
  // through — this is the admin panel's "quantos Apertos pra ver o vídeo".
  useEffect(() => {
    signalingClient.reportPartnerRewardVideoOpen(partnerId);
  }, [partnerId]);

  // Progress is saved on the way out however the popup goes away — the ×
  // below, or anything else that unmounts it (closeAllPopups, a navigation).
  // Deliberately reads maxTimeRef rather than the element: the element may
  // already be detached by cleanup time, and maxTimeRef is the number that
  // matters anyway (handleTimeUpdate keeps it within a timeupdate tick of
  // currentTime, which is far finer than a resume point needs).
  useEffect(() => {
    return () => {
      if (maxTimeRef.current > 0) setStoredPartnerVideoProgress(partnerId, maxTimeRef.current);
    };
  }, [partnerId]);

  function handleLoadedMetadata() {
    const video = videoRef.current;
    if (!video) return;
    setVideoReady(true);
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
  // "no visible seek bar." Lifted entirely once the video has been watched
  // through: from then on this is an ordinary video player.
  function handleSeeking() {
    if (unlocked) return;
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
    // Checked here rather than by disabling the button: the button has to
    // stay clickable for a guest, because the click is what surfaces the
    // notice below.
    if (!account) {
      setClaimAttemptedSignedOut(true);
      trackEvent("partner_reward_claim_needs_login", { partnerId });
      return;
    }
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

  // Everything the locked player does — no native controls, no seek, the
  // pause/rewatch overlays, the custom mute + timecode + progress strip —
  // exists to make "watched it" mean something. Once it does, the popup
  // hands the whole player over and gets out of the way.
  const playerUnlocked = unlocked;

  return (
    <div className="flex flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      {/* Whose ad this is, above the video — by the time someone is in
          here, the card that explained it is behind a backdrop. */}
      <div className="flex items-start gap-3 border-b border-zinc-200 p-3 dark:border-zinc-800">
        {/* {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
        )} */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-semibold">{title}</p>
            <span className="shrink-0 rounded-full bg-black/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide opacity-70 dark:bg-white/10">
              Patrocinado
            </span>
          </div>
          <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-xs opacity-60">
            {description}
          </p>
        </div>
        <button
          type="button"
          // requireAction is on, so only closePopup(true) gets out — the
          // backdrop and Escape deliberately don't.
          onClick={() => closePopup(true)}
          aria-label="Sair do vídeo"
          className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xl leading-none opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
        >
          ×
        </button>
      </div>

      {/* A fixed 16:9 box, sized before the video has loaded a single byte:
          left to its own intrinsic size, the element starts at roughly
          300x150 and the whole popup — already centered and animated in —
          resizes around it the moment metadata arrives. Whatever the file's
          real aspect turns out to be, it letterboxes inside this instead of
          reshaping the popup. */}
      <div className="relative aspect-video max-h-[70dvh] w-full bg-black">
        <video
          ref={videoRef}
          src={videoUrl}
          muted={muted}
          playsInline
          // Everything here flips the moment the video has been watched
          // through: native controls (seek bar, volume, speed, fullscreen)
          // appear, and the click-to-toggle handler steps aside so it
          // doesn't fight them.
          controls={playerUnlocked}
          controlsList="nodownload"
          disablePictureInPicture={!playerUnlocked}
          onContextMenu={(e) => e.preventDefault()}
          onClick={playerUnlocked ? undefined : togglePlayPause}
          onPlay={handlePlay}
          onPause={handlePause}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onSeeking={handleSeeking}
          onEnded={handleEnded}
          onError={() => setLoadFailed(true)}
          className={`absolute inset-0 h-full w-full object-contain ${
            playerUnlocked ? "" : "cursor-pointer"
          }`}
        />

        {/* Sits above the video and below every other overlay: until the
            file has said what it is, none of the play/pause/rewatch states
            mean anything yet. */}
        {!videoReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            {loadFailed ? (
              <p className="px-4 text-center text-sm text-white/70">
                Não foi possível carregar o vídeo.
              </p>
            ) : (
              <span
                role="status"
                aria-label="Carregando vídeo"
                className="h-9 w-9 animate-spin rounded-full border-2 border-white/25 border-t-white"
              />
            )}
          </div>
        )}

        {/* One overlay at a time, in priority order: the video having
            actually ended outranks a mid-playback pause, which outranks
            the very first autoplay-blocked state. None of them render once
            the player is unlocked — they would sit on top of the native
            controls, and each one's job is already done by then. */}
        {videoReady &&
          !playerUnlocked &&
          (hasEnded ? (
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
          ))}

        {/* Stand-in chrome for the locked player: mute, a timecode, and a
            bar that shows progress without offering to change it. All of
            it becomes native once unlocked. */}
        {videoReady && !playerUnlocked && (
          <>
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? "Ativar som" : "Silenciar"}
              className="absolute bottom-3 left-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80"
            >
              {muted ? (
                <SpeakerMuteIcon className="h-4 w-4" />
              ) : (
                <SpeakerIcon className="h-4 w-4" />
              )}
            </button>

            <span className="absolute bottom-3 right-3 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>

            {/* Visual only, on purpose — a plain filled bar, not a native
                range/progress control, so there is nothing here to drag or
                click to seek. See the module doc comment. */}
            <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
              <div
                className="h-full bg-emerald-500"
                style={{
                  width: duration > 0 ? `${Math.min(100, (currentTime / duration) * 100)}%` : "0%",
                }}
              />
            </div>
          </>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800">
        <div className="flex flex-col gap-2 sm:flex-row">
          <a
            href={buttonUrl}
            target="_blank"
            rel="noopener noreferrer"
            // Same click reported by PartnerCard's own CTA — this is the
            // same button (label + link), just also reachable from inside
            // the reward popup, so it counts toward the same "Cliques" stat
            // rather than a separate number the admin panel has to add up.
            onClick={() => signalingClient.reportPartnerClick(partnerId)}
            className="flex-1 truncate rounded-lg border border-zinc-300 px-4 py-2.5 text-center text-sm font-semibold transition hover:bg-black/5 dark:border-white/30 dark:hover:bg-white/10"
          >
            {buttonLabel}
          </a>
          <button
            type="button"
            onClick={handleClaim}
            // Deliberately not disabled for a signed-out visitor: handleClaim
            // turns that click into the notice below instead of a dead button.
            disabled={!unlocked || claiming || claimed || alreadyClaimed}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-400"
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
              "Resgatando..."
            ) : unlocked ? (
              <>
                Resgatar
                <BsCoin className="h-4 w-4 shrink-0" />
                {points} pontos
              </>
            ) : (
              "Assista até o fim para resgatar"
            )}
          </button>
        </div>
        {claimAttemptedSignedOut && !account && !claimed && !alreadyClaimed && (
          <p className="text-center text-xs text-amber-600 dark:text-amber-400">
            Crie uma conta ou entre em uma para poder resgatar os pontos.
          </p>
        )}
        {claimError && !claimed && !alreadyClaimed && (
          <p className="text-center text-xs text-red-600 dark:text-red-400">{claimError}</p>
        )}
      </div>
    </div>
  );
}
