import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ruter Reisetid",
    short_name: "Reisetid",
    description: "Interaktivt isokron-kart for Ruter",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ede7df",
    theme_color: "#313663",
    icons: [
      {
        src: "/apple-touch-icon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/apple-touch-icon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/favicon.png",
        sizes: "any",
        type: "image/png",
      },
    ],
  };
}
