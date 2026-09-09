import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Archviz | Powered by Menova Studio",
    template: "%s · Archviz",
  },
  description:
    "Archviz by Menova Studio. Architectural model presentations, room-scale mixed reality, and immersive walkthroughs on web, mobile and Meta Quest.",
};

export const viewport: Viewport = {
  themeColor: "#101415",
  width: "device-width",
  initialScale: 1,
  // Prevents iOS double-tap zoom from fighting the viewer's touch controls.
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${inter.variable} ${jakarta.variable} ${jetbrains.variable}`}
    >
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
