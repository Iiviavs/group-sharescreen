"use client";

import { useSyncExternalStore } from "react";
import { signalingClient } from "./signalingClient";

export function useSignaling() {
  return useSyncExternalStore(
    signalingClient.subscribe,
    signalingClient.getSnapshot,
    signalingClient.getSnapshot
  );
}
