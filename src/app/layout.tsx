import type { Metadata, Viewport } from "next";
import "./globals.css";
import { RegisterServiceWorker } from "./register-sw";

export const metadata: Metadata = {
  title: "Founder OS",
  description: "Your private operating system.",
};

export const viewport: Viewport = { themeColor: "#fcfaea" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}<RegisterServiceWorker /></body>
    </html>
  );
}
