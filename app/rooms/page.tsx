import type { Metadata } from "next";
import { RoomsPageClient } from "./RoomsPageClient";

export const metadata: Metadata = {
  title: "Salas públicas de transmissão de tela",
  description:
    "Veja as salas públicas de transmissão de tela em grupo ativas agora no GoLive e entre para assistir ou compartilhar sua tela ao vivo, sem cadastro.",
  alternates: {
    canonical: "/rooms",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RoomsPage() {
  return <RoomsPageClient />;
}
