import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Founder OS",
    short_name: "Founder OS",
    description: "Your private operating system for business, projects, university and daily life.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#070b16",
    theme_color: "#070b16",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
