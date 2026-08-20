import { ImageResponse } from "next/og";

export const alt = "GoLive — transmissão de tela em grupo online";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#09090b",
          color: "#fafafa",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
          }}
        >
          <div
            style={{
              display: "flex",
              width: 88,
              height: 88,
              borderRadius: 24,
              background: "#ef4444",
            }}
          />
          <div style={{ display: "flex", fontSize: 96, fontWeight: 700 }}>
            GoLive
          </div>
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 28,
            fontSize: 40,
            color: "#a1a1aa",
            textAlign: "center",
            maxWidth: 980,
          }}
        >
          Transmissão de tela em grupo online, grátis e sem cadastro
        </div>
      </div>
    ),
    { ...size }
  );
}
