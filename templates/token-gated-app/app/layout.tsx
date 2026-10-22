import type { Metadata, Viewport } from "next";
import { Grandstander } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

/** pepeunchained.com's display face, self-hosted by next/font at build time. */
const grandstander = Grandstander({
  subsets: ["latin"],
  variable: "--font-grandstander",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#051706",
  colorScheme: "dark",
};

export const metadata: Metadata = {
  title: "PEPU Token Gate — Unlock content by holding a token",
  description:
    "A starter that gates content behind an ERC-20 or NFT balance on Pepe Unchained V2, checked with a single batched Multicall3 read.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={grandstander.variable}>
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
