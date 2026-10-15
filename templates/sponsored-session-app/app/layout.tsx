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
  title: "PEPU Sponsored Session App",
  description:
    "Sign in with Google, grant a scoped on-chain session once, then act with no wallet popup and no gas: a ZeroDev Kernel session key plus a PEPU paymaster on Pepe Unchained V2.",
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
