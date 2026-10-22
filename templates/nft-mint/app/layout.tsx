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
  title: "PEPU NFT Mint — Sign in, mint, own it onchain",
  description:
    "A starter that mints a real ERC-721 on Pepe Unchained V2: email login, an embedded wallet, and a mint transaction you can verify on pepuscan.",
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
