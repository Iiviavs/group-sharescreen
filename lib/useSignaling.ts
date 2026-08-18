"use client";

import { useSyncExternalStore } from "react";
import { signalingClient, getStoredName } from "./signalingClient";

export function useSignaling() {
  return useSyncExternalStore(
    signalingClient.subscribe,
    signalingClient.getSnapshot,
    signalingClient.getSnapshot
  );
}

function noopSubscribe() {
  return () => {};
}
function getHasStoredName() {
  return getStoredName() !== null;
}
function getHasStoredNameServer() {
  return false;
}

export function useHasStoredName() {
  return useSyncExternalStore(noopSubscribe, getHasStoredName, getHasStoredNameServer);
}
