"use client";

import { useEffect, useState } from "react";
import { fetchPeopleOnline, getSignalingHttpBase } from "@/lib/roomsApi";
import { trackEvent } from "@/lib/analytics";
import { ArrowLeftIcon, ChartIcon, ChevronUpIcon } from "@/components/icons";
import { PartnerAdCustomizer, type AdForm } from "@/components/PartnerAdCustomizer";

const STATS_DASHBOARD_URL = process.env.NEXT_PUBLIC_STATS_DASHBOARD_URL;
const PEOPLE_COUNT_POLL_MS = 8000;

// Naming everything "partner" instead of "ad"/"advertisement" throughout —
// element ids, class names, API path, etc. — is deliberate: ad blockers
// filter on those words, and this card would otherwise get silently hidden
// for a chunk of visitors.
type PartnerCardData = {
  title: string;
  description: string;
  imageUrl?: string | null;
  buttonLabel: string;
  buttonUrl: string;
  backgroundColor?: string;
  textColor?: string;
  buttonBackgroundColor?: string;
  buttonTextColor?: string;
};

async function fetchPartner(signal?: AbortSignal): Promise<PartnerCardData | null> {
  const res = await fetch(`${getSignalingHttpBase()}/partner`, { signal });
  if (!res.ok) throw new Error(`Falha ao carregar parceiro (status ${res.status})`);
  const data = (await res.json()) as { partner: PartnerCardData | null };
  return data.partner;
}

// Shown whenever the /partner API has nothing configured (null response, or
// the request itself failing) — a house ad for this site's own Discord
// instead of an empty slot.
const FALLBACK_PARTNER: PartnerCardData = {
  title: "Anuncie aqui pra todo mundo!",
  description: "Esse site é visitado por mais de 10 mil por dia!\n\nAbra um ticket no meu Discord e anuncie",
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
  const [partner, setPartner] = useState<PartnerCardData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [peopleOnline, setPeopleOnline] = useState<number | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [showingExample, setShowingExample] = useState(false);
  const [customizerOpen, setCustomizerOpen] = useState(false);

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

  // Only meaningful for the house ad below (a real, paid partner slot isn't
  // the place for the site's own stats plug) — skipped entirely once a real
  // partner is configured, so this never fires an extra poll for nothing.
  useEffect(() => {
    if (partner !== null) return;
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
  }, [partner]);

  if (!loaded) return null;

  const data = partner ?? FALLBACK_PARTNER;
  const isFallback = partner === null;
  // Hidden while showingExample — the whole point of the example is to be a
  // faithful preview of a real ad slot, which never has this site's own
  // counter riding inside it.
  const showOnlineWidget = isFallback && !showingExample && peopleOnline !== null;
  const displayData = isFallback && showingExample ? EXAMPLE_PARTNER : data;

  return (
    <div className="relative mt-auto w-full shrink-0">
      {statsOpen && showOnlineWidget && (
        <div className="absolute inset-x-0 bottom-full z-10 mb-2 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
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
      )}

      {isFallback && showingExample && (
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

      <div
        className="w-full overflow-hidden rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
        style={{
          backgroundColor: data.backgroundColor ?? "#ffffff",
          color: data.textColor ?? "#18181b",
        }}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          {showOnlineWidget && (
            <button
              type="button"
              onClick={() => setStatsOpen((open) => !open)}
              aria-expanded={statsOpen}
              className="flex items-center gap-1 text-xs font-medium text-emerald-400 cursor-pointer"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
              {peopleOnline} online agora
              <ChevronUpIcon
                className={`h-3 w-3 transition-transform ${statsOpen ? "rotate-180" : ""}`}
              />
            </button>
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
            className="mb-2 max-h-32 w-full rounded-lg object-cover"
          />
        )}

        <p className="text-sm font-semibold">{displayData.title}</p>
        <p className="mt-1 whitespace-pre-line text-xs opacity-80">{displayData.description}</p>

        <a
          href={displayData.buttonUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() =>
            trackEvent("partner_card_clicked", {
              fallback: isFallback,
              example: isFallback && showingExample,
            })
          }
          className="mt-3 block rounded-lg px-3 py-2 text-center text-sm font-semibold transition hover:opacity-90"
          style={{
            backgroundColor: displayData.buttonBackgroundColor ?? "#18181b",
            color: displayData.buttonTextColor ?? "#ffffff",
          }}
        >
          {displayData.buttonLabel}
        </a>

        {isFallback && !showingExample && (
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

      {customizerOpen && (
        <PartnerAdCustomizer
          initial={CUSTOMIZER_STARTING_POINT}
          onClose={() => setCustomizerOpen(false)}
        />
      )}
    </div>
  );
}
