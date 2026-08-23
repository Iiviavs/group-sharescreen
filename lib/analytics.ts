"use client";

type UmamiWindow = Window & {
  umami?: {
    track: (eventName: string, data?: Record<string, unknown>) => void;
  };
};

export function trackEvent(name: string, data?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  (window as UmamiWindow).umami?.track(name, data);
}

