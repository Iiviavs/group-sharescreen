"use client";

import { SpeakerIcon, SpeakerMuteIcon } from "./icons";

function clampVolume(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function VolumeSlider({
  value,
  label,
  onChange,
  muted = false,
  onToggleMute,
  showIcon = true,
  collapseOnIdle = false,
  className = "",
}: {
  value: number;
  label: string;
  onChange: (value: number) => void;
  muted?: boolean;
  onToggleMute?: () => void;
  showIcon?: boolean;
  collapseOnIdle?: boolean;
  className?: string;
}) {
  const normalizedValue = clampVolume(value);
  const icon =
    muted || normalizedValue === 0 ? (
      <SpeakerMuteIcon className="h-4 w-4 shrink-0" />
    ) : (
      <SpeakerIcon className="h-4 w-4 shrink-0" />
    );

  function handleIconClick(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    onToggleMute?.();
  }

  return (
    <div
      className={`${collapseOnIdle ? "group relative z-20" : ""} flex min-w-0 items-center gap-1.5 ${className}`}
      title={`${label}: ${Math.round(normalizedValue * 100)}%`}
      onClick={(event) => event.stopPropagation()}
    >
      {showIcon &&
        (onToggleMute ? (
          <button
            type="button"
            onClick={handleIconClick}
            title={muted || normalizedValue === 0 ? "Reativar áudio" : "Silenciar áudio"}
            aria-label={
              muted || normalizedValue === 0 ? "Reativar áudio" : "Silenciar áudio"
            }
            className="rounded p-1 transition hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            {icon}
          </button>
        ) : (
          icon
        ))}
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={normalizedValue}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
        className={`min-w-0 cursor-pointer accent-current transition-opacity duration-150 ${
          collapseOnIdle
            ? "pointer-events-none absolute right-6 top-1/2 z-10 w-24 -translate-y-1/2 rounded-full bg-zinc-50/95 px-2 py-1 opacity-0 shadow-sm group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 dark:bg-zinc-900/95"
            : "h-1.5 w-20 sm:w-24"
        }`}
      />
    </div>
  );
}
