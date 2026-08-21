"use client";

import { useEffect, useRef, useState } from "react";
import { fetchPeopleOnline, getSignalingHttpBase } from "@/lib/roomsApi";
import { trackEvent } from "@/lib/analytics";
import { useSignaling } from "@/lib/useSignaling";
import { signalingClient } from "@/lib/signalingClient";
import { ArrowLeftIcon, ChartIcon, ChevronUpIcon } from "@/components/icons";
import { PartnerAdCustomizer, type AdForm } from "@/components/PartnerAdCustomizer";
import { Popover } from "@/components/Tooltip";

const STATS_DASHBOARD_URL = process.env.NEXT_PUBLIC_STATS_DASHBOARD_URL;
const PEOPLE_COUNT_POLL_MS = 8000;

// Naming everything "partner" instead of "ad"/"advertisement" throughout —
// element ids, class names, API path, etc. — is deliberate: ad blockers
// filter on those words, and this card would otherwise get silently hidden
// for a chunk of visitors.
type PartnerCardData = {
  // Only present for a real, backend-sourced ad (server/signaling.ts's
  // publicPartner always includes it) — never on FALLBACK_PARTNER/
  // EXAMPLE_PARTNER below, which is what tells them apart for view/click
  // reporting (see the effects below) and expiration.
  id?: string;
  title: string;
  description: string;
  imageUrl?: string | null;
  buttonLabel: string;
  buttonUrl: string;
  backgroundColor?: string | null;
  textColor?: string | null;
  buttonBackgroundColor?: string | null;
  buttonTextColor?: string | null;
  // epoch ms; null/absent = never expires. Drives the expiration effect
  // below, which removes the card the instant this passes without waiting
  // for a reload or a live update.
  expiresAt?: number | null;
};

async function fetchPartner(signal?: AbortSignal): Promise<PartnerCardData | null> {
  const res = await fetch(`${getSignalingHttpBase()}/partner`, { signal });
  if (!res.ok) throw new Error(`Falha ao carregar parceiro (status ${res.status})`);
  const data = (await res.json()) as { partner: PartnerCardData | null };
  return data.partner;
}

// Shown whenever there's no real partner ad to display — either the site
// has none active at all, or this request landed on the server's "show
// nothing X% of the time" roll (see server/signaling.ts's GET /partner) —
// a house ad for this site's own Discord instead of an empty slot.
const FALLBACK_PARTNER: PartnerCardData = {
  title: "Anuncie aqui pra todo mundo!",
  description: "Esse site é visitado por mais de 10 mil pessoas por dia!\n\nAbra um ticket no meu Discord e vamos combinar um anúncio",
  buttonLabel: "Abrir ticket no Discord",
  buttonUrl: "https://go.nemtudo.me/golive-partner-nemtudodiscord",
  backgroundColor: "#111827",
  textColor: "#f4f4f5",
  buttonBackgroundColor: "#5865f2",
  buttonTextColor: "#ffffff",
};

// The "ver exemplo de anúncio" button shows this — a real slot advertising
// NemTudo's own X/Twitter, styled in X's black/white so it visibly reads as
// a real ad rather than another site UI element.
const EXAMPLE_PARTNER: PartnerCardData = {
  title: "Me segue no Twitter!",
  description: "Posto updates dos meus projetos, coisas aleatórias, coisas da vida, eventos, etc.\n\nSegue aí gay",
  buttonLabel: "Sou lindo e vou seguir",
  imageUrl: "https://cdn.nemtudo.me/f/nemtudo/MjAyNi8wOC8yMC9JTUFHRS8wMl8yOF8wMl9fMTc4NzIwMzY4MjQyNC02NzMxNDIwNTI.webp",
  buttonUrl: "https://go.nemtudo.me/golive-partner-twitter",
  backgroundColor: "#000000",
  textColor: "#ffffff",
  buttonBackgroundColor: "#ffffff",
  buttonTextColor: "#000000",
};

// Starting point handed to the customizer — generic placeholders (not a
// copy of EXAMPLE_PARTNER's Twitter branding) so it reads as "your ad here"
// rather than nudging everyone toward black-and-white.
const CUSTOMIZER_STARTING_POINT: AdForm = {
  title: "Sua marca aqui",
  description: "Escreva uma descrição curta e chamativa sobre o que você quer anunciar.",
  imageUrl: "",
  buttonLabel: "Saiba mais",
  buttonUrl: "https://",
  backgroundColor: "#111827",
  textColor: "#f4f4f5",
  buttonBackgroundColor: "#10b981",
  buttonTextColor: "#ffffff",
};

// Docked at the bottom of the sidebar (participants/chat) column, not a
// floating overlay — deliberately named "partner" everywhere (component,
// api, props, tracked events) rather than "ad" so it doesn't get swept up by
// ad-blocker filter lists that key off that word.
export function PartnerCard() {
  const signalingState = useSignaling();
  const [partner, setPartner] = useState<PartnerCardData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [peopleOnline, setPeopleOnline] = useState<number | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [showingExample, setShowingExample] = useState(false);
  // Lets someone looking at a real, paid ad discover they could buy this
  // slot too — toggled by the "Anuncie aqui você também!" header shown over
  // a real ad below, and swaps the card to the same house ad that's shown
  // by default when no real partner is active (FALLBACK_PARTNER).
  const [showingHouseAd, setShowingHouseAd] = useState(false);
  const [customizerOpen, setCustomizerOpen] = useState(false);
  // Below lg, this starts collapsed to just a slim title bar — full-size,
  // it was eating a big enough chunk of a phone's height (image, multi-line
  // description, two buttons) to fight the room's own video/chat for space.
  // Tapping the bar expands it back to the full card. Ignored (always
  // expanded) from lg: on, same as the participants/chat drawer in
  // WatchRoom.tsx — see its collapsed/expanded reasoning for why this
  // pattern beats just shrinking things responsively: a phone screen is
  // short enough that even a "compact" card still costs real space by
  // default, so it should cost none until asked for.
  const [collapsed, setCollapsed] = useState(true);

  // Initial value, over plain HTTP — respects the server's "show nothing
  // X% of the time" roll (see server/signaling.ts's GET /partner and
  // partnerStore.ts's emptyPercent). A live socket update (the effect
  // below) always overrides this once one arrives, since that path
  // deliberately never rolls that percentage — see its own comment.
  useEffect(() => {
    const controller = new AbortController();
    fetchPartner(controller.signal)
      .then((data) => {
        setPartner(data);
        setLoaded(true);
      })
      .catch(() => {
        // Treated the same as "no partner configured" — a broken /partner
        // endpoint shouldn't take the house ad down with it.
        setPartner(null);
        setLoaded(true);
      });
    return () => controller.abort();
  }, []);

  // Live updates while this card stays mounted — pushed by the server after
  // every admin create/edit/delete (see broadcastPartnerUpdate), so an
  // already-open tab updates immediately instead of only on its next
  // reload. `partnerSeq` (see signalingClient.ts) is what tells "a live
  // update actually arrived, and it's authoritative" apart from "nothing's
  // arrived yet, the HTTP fetch above is still the freshest thing we know"
  // — both would otherwise look identical as a bare `partner: null`.
  const lastHandledPartnerSeq = useRef(0);
  useEffect(() => {
    if (signalingState.partnerSeq === 0 || signalingState.partnerSeq === lastHandledPartnerSeq.current) {
      return;
    }
    lastHandledPartnerSeq.current = signalingState.partnerSeq;
    setPartner(signalingState.partner);
    setLoaded(true);
  }, [signalingState.partnerSeq, signalingState.partner]);

  // Removes an expired ad the instant it expires, without waiting for a
  // reload or a live update to do it — falls back to the house ad exactly
  // like any other "no partner active" state.
  useEffect(() => {
    if (!partner?.expiresAt) return;
    // Already-expired (remaining <= 0) still goes through setTimeout rather
    // than calling setPartner synchronously right here — deferring it to a
    // callback (even a same-tick one) keeps this a pure "schedule a
    // reaction," not a synchronous state write during the effect itself.
    const remaining = Math.max(0, partner.expiresAt - Date.now());
    const timer = setTimeout(() => setPartner(null), remaining);
    return () => clearTimeout(timer);
  }, [partner]);

  // Views only count for a genuinely visible tab — same reasoning as
  // AnnouncementBanner.tsx's identical guard — and only for a real,
  // backend-sourced ad (never the fallback/example ones, which have no id
  // and aren't things the admin is tracking engagement for).
  const reportedViewIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    const id = partner?.id;
    if (!id) return;
    function maybeReportView() {
      if (document.visibilityState !== "visible") return;
      if (reportedViewIds.current.has(id!)) return;
      reportedViewIds.current.add(id!);
      signalingClient.reportPartnerView(id!);
    }
    maybeReportView();
    document.addEventListener("visibilitychange", maybeReportView);
    return () => document.removeEventListener("visibilitychange", maybeReportView);
  }, [partner]);

  // Runs regardless of whether a real partner is configured: the count now
  // shows next to "Anuncie aqui você também!" over a real ad too, not just
  // inside the house ad itself, so there's no state where it's unneeded.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function load() {
      try {
        const count = await fetchPeopleOnline(controller.signal);
        if (!cancelled) setPeopleOnline(count);
      } catch {
        // Directory unreachable — leave the last known count in place
        // rather than flashing an error over a non-essential counter.
      }
    }

    load();
    const interval = setInterval(load, PEOPLE_COUNT_POLL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, []);

  if (!loaded) return null;

  const data = partner ?? FALLBACK_PARTNER;
  const isFallback = partner === null;
  // True only when the real ad is what's actually on screen — false for the
  // plain house ad, the "ver exemplo" preview, and a real ad temporarily
  // swapped out for the house ad via showingHouseAd below. Drives both the
  // header above the card and what counts as a click on the real ad.
  const showingRealAd = !isFallback && !showingHouseAd;
  // True whenever FALLBACK_PARTNER is what's on screen — the plain default
  // (no real ad configured) as much as a real ad temporarily swapped out via
  // showingHouseAd. Everything that's specific to the house ad (the online
  // counter, the "ver exemplo" button) keys off this, not off isFallback
  // alone, so toggling into the house ad from a real one gets the full
  // experience instead of a stripped-down version of it.
  const showingHouseAdContent = !showingRealAd && !showingExample;
  // Whether the online-count popover has a trigger to anchor to anywhere on
  // the card right now — one renders inside the house ad, another sits next
  // to "Anuncie aqui você também!" over a real ad (see below), but never
  // during showingExample: the whole point of the example is to be a
  // faithful preview of a real ad slot, which never has this site's own
  // counter riding inside it.
  const showOnlineWidget = !showingExample && peopleOnline !== null;
  const displayData = showingRealAd ? data : showingExample ? EXAMPLE_PARTNER : FALLBACK_PARTNER;

  // One panel, two possible triggers (the counter inside the house ad, and
  // the one next to "Anuncie aqui também!" over a real ad) — only ever one of
  // them is on screen at a time, so they share both this markup and the
  // statsOpen state.
  const statsPanel = (
    <div className="w-72 max-w-[calc(100vw-1rem)] rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        Curioso(a) pra saber quantas pessoas estão compartilhando tela agora, quantas
        salas estão rolando e muito mais? Acompanhe tudo ao vivo no painel de
        estatísticas do site!
      </p>
      {STATS_DASHBOARD_URL && (
        <a
          href={STATS_DASHBOARD_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => trackEvent("stats_dashboard_opened")}
          className="mt-2 flex items-center justify-center gap-1.5 rounded-lg bg-zinc-950 px-3 py-1.5 text-center text-xs font-semibold text-white transition hover:opacity-90 dark:bg-zinc-50 dark:text-zinc-950"
        >
          <ChartIcon className="h-3.5 w-3.5" />
          Ver estatísticas ao vivo
        </a>
      )}
    </div>
  );

  return (
    <div className="relative mt-auto w-full shrink-0">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="mb-1.5 flex w-full items-center justify-between gap-2 rounded-lg bg-zinc-100 px-3 py-1.5 text-left text-xs font-medium text-zinc-600 transition hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 lg:hidden"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide dark:bg-white/10">
            Patrocinado
          </span>
          <span className="truncate">{displayData.title}</span>
        </span>
        <ChevronUpIcon
          className={`h-3.5 w-3.5 shrink-0 transition-transform ${collapsed ? "rotate-180" : ""}`}
        />
      </button>

      <div className={`${collapsed ? "hidden" : "block"} lg:block`}>
      {showingExample && (
        <div className="mb-2">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setShowingExample(false)}
              className="flex items-center gap-1 text-xs font-medium text-zinc-500 transition hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              <ArrowLeftIcon className="h-3 w-3" />
              Voltar
            </button>
            <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-600">
              Exemplo de anúncio
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              trackEvent("partner_customizer_opened");
              setCustomizerOpen(true);
            }}
            className="block w-full rounded-lg border border-emerald-500/60 bg-emerald-500/10 px-3 py-1.5 text-center text-xs font-semibold text-emerald-700 transition hover:bg-emerald-500/20 dark:border-emerald-400/50 dark:text-emerald-400 dark:hover:bg-emerald-400/10"
          >
            Ver como vai ficar meu anúncio
          </button>
        </div>
      )}

      {showingRealAd && (
        <div className="mb-1.5 flex items-center gap-2">
          {peopleOnline !== null && (
            <Popover
              open={statsOpen}
              onClose={() => setStatsOpen(false)}
              placement="top"
              content={statsPanel}
            >
              <button
                type="button"
                onClick={() => setStatsOpen((open) => !open)}
                className="flex shrink-0 items-center gap-1 rounded-lg bg-zinc-100 px-2.5 py-1.5 text-xs font-medium text-emerald-600 transition hover:bg-zinc-200 dark:bg-zinc-900 dark:text-emerald-400 dark:hover:bg-zinc-800"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                {peopleOnline} on
                <ChevronUpIcon
                  className={`h-3 w-3 transition-transform ${statsOpen ? "rotate-180" : ""}`}
                />
              </button>
            </Popover>
          )}
          <button
            type="button"
            onClick={() => {
              trackEvent("partner_house_ad_from_real_ad");
              setShowingHouseAd(true);
            }}
            className="flex-1 rounded-lg bg-zinc-100 px-3 py-1.5 text-center text-xs font-semibold text-zinc-600 transition hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            Anuncie aqui também!
          </button>
        </div>
      )}

      {!isFallback && showingHouseAd && !showingExample && (
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setShowingHouseAd(false)}
            className="flex items-center gap-1 text-xs font-medium text-zinc-500 transition hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            <ArrowLeftIcon className="h-3 w-3" />
            Voltar
          </button>
          <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-600">
            Anuncie aqui
          </span>
        </div>
      )}

      <div
        className="w-full overflow-hidden rounded-lg border border-zinc-200 p-3 dark:border-zinc-800 sm:p-4"
        style={{
          backgroundColor: displayData.backgroundColor ?? "#ffffff",
          color: displayData.textColor ?? "#18181b",
        }}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          {showingHouseAdContent && showOnlineWidget && (
            <Popover
              open={statsOpen}
              onClose={() => setStatsOpen(false)}
              placement="top"
              content={statsPanel}
            >
              <button
                type="button"
                onClick={() => setStatsOpen((open) => !open)}
                className="flex items-center gap-1 text-xs font-medium text-emerald-400 cursor-pointer"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                {peopleOnline} online agora
                <ChevronUpIcon
                  className={`h-3 w-3 transition-transform ${statsOpen ? "rotate-180" : ""}`}
                />
              </button>
            </Popover>
          )}
          <span className="shrink-0 rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide opacity-70 dark:bg-white/10">
            Patrocinado
          </span>
        </div>

        {displayData.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={displayData.imageUrl}
            alt=""
            className="mb-2 max-h-20 w-full rounded-lg object-cover sm:max-h-32"
          />
        )}

        <p className="text-sm font-semibold">{displayData.title}</p>
        <p className="mt-1 line-clamp-3 whitespace-pre-line text-xs opacity-80 sm:line-clamp-none">
          {displayData.description}
        </p>

        <a
          href={displayData.buttonUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            // Only counts as a click on the real ad while it's actually the
            // thing being shown — not while a real advertiser's slot is
            // temporarily swapped out for the house ad via showingHouseAd.
            if (showingRealAd && data.id) signalingClient.reportPartnerClick(data.id);
            trackEvent("partner_card_clicked", {
              fallback: isFallback,
              example: showingExample,
              houseAd: !isFallback && showingHouseAd,
            });
          }}
          className="mt-3 block rounded-lg px-3 py-2 text-center text-sm font-semibold transition hover:opacity-90"
          style={{
            backgroundColor: displayData.buttonBackgroundColor ?? "#18181b",
            color: displayData.buttonTextColor ?? "#ffffff",
          }}
        >
          {displayData.buttonLabel}
        </a>

        {showingHouseAdContent && (
          <button
            type="button"
            onClick={() => {
              trackEvent("partner_example_viewed");
              setStatsOpen(false);
              setShowingExample(true);
            }}
            className="mt-2 block w-full rounded-lg border border-current px-3 py-1.5 text-center text-xs font-medium opacity-70 transition hover:opacity-100"
          >
            Ver exemplo de anúncio
          </button>
        )}
      </div>
      </div>

      {customizerOpen && (
        <PartnerAdCustomizer
          initial={CUSTOMIZER_STARTING_POINT}
          onClose={() => setCustomizerOpen(false)}
        />
      )}
    </div>
  );
}
