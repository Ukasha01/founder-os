import type { Metadata, Viewport } from "next";
import "./globals.css";
import { RegisterServiceWorker } from "./register-sw";
import { SpeedInsights } from "@vercel/speed-insights/next";

export const metadata: Metadata = {
  title: "Founder OS",
  description: "Your private operating system.",
};

export const viewport: Viewport = { themeColor: "#eff2f9" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}<RegisterServiceWorker /><SpeedInsights /></body>
    </html>
  );
}
