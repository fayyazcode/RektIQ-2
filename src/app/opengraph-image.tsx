import { ImageResponse } from "next/og";
import { SITE } from "@/lib/config";

export const alt = SITE.name;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Og() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", background: "#000", padding: 80, border: "8px solid #22863a" }}>
        <div style={{ fontSize: 110, fontWeight: 800, color: "#4ade80", letterSpacing: -2 }}>{SITE.name}</div>
        <div style={{ fontSize: 40, color: "#dfeadf", marginTop: 24, maxWidth: 900 }}>{SITE.tagline}</div>
      </div>
    ),
    size
  );
}
