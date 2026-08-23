"use client";

import { useEffect, useRef, useState } from "react";
import { getSignalingHttpBase } from "@/lib/roomsApi";
import { useSignaling } from "@/lib/useSignaling";
import type { Supporter } from "@/lib/supporter";

async function fetchSupporters(signal?: AbortSignal): Promise<Supporter[]> {
  const res = await fetch(`${getSignalingHttpBase()}/supporters`, { signal });
  if (!res.ok) throw new Error(`Falha ao carregar apoiadores (status ${res.status})`);
  const data = (await res.json()) as { supporters: Supporter[] };
  return data.supporters;
}

const currencyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

// Hover content for the "Apoiar projeto" button (WatchRoom.tsx). Falls back
// to the original plain-text hint whenever there's nothing configured yet,
// so an empty admin list looks exactly like it did before this feature
// existed rather than showing an empty card. The list itself arrives
// pre-sorted descending by amount (server/signaling.ts's sortSupporters),
// so there's no client-side re-sort here.
export function SupportersTooltipContent() {
  const signalingState = useSignaling();
  const [supporters, setSupporters] = useState<Supporter[]>([]);
  const lastHandledSeq = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchSupporters(controller.signal)
      .then(setSupporters)
      .catch(() => {
        // Keeps whatever was already shown (or the empty-list fallback) —
        // a failed fetch shouldn't break the button's own hint.
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (signalingState.supportersSeq === 0 || signalingState.supportersSeq === lastHandledSeq.current) {
      return;
    }
    lastHandledSeq.current = signalingState.supportersSeq;
    setSupporters(signalingState.supporters);
  }, [signalingState.supportersSeq, signalingState.supporters]);

  if (supporters.length === 0) {
    return "Apoiar o projeto no LivePix";
  }

  return (
    <div className="max-h-60 w-56 overflow-y-auto">
      <p className="mb-1.5 px-0.5 text-[0.65rem] font-semibold tracking-wide text-zinc-400 uppercase">
        Apoiadores
      </p>
      <ul className="flex flex-col gap-1">
        {supporters.map((s, i) => (
          <li key={`${s.name}-${i}`}>
            <span className="font-semibold">{s.name}</span> doou {currencyFormatter.format(s.amount)}
          </li>
        ))}
      </ul>
    </div>
  );
}
