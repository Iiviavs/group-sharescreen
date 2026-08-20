import type { MetadataRoute } from "next";

// Served at /manifest.webmanifest (see get-metadata-route.js's naming for
// the "manifest" special case) — layout.tsx's `metadata.manifest` is what
// actually links it into <head>, since Next doesn't do that automatically
// just from this file existing.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GoLive — Transmissão de Tela em Grupo Online Grátis",
    short_name: "GoLive",
    description:
      "Transmita sua tela para várias pessoas ao mesmo tempo, direto do navegador. Crie uma sala em 4 cliques sem cadastro.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      {
        src: "/icon.png",
        sizes: "500x500",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
