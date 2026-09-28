import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Polaris",
    short_name: "Polaris",
    description: "Pay in full, in four or every month, and send dollars anywhere with a link. Just Face ID.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0f1011",
    theme_color: "#0f1011",
    categories: ["finance", "shopping"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Pay or claim", url: "/pay", description: "Scan or paste a Polaris link" },
      { name: "Send money", url: "/send", description: "Send dollars with a link" },
    ],
  };
}
