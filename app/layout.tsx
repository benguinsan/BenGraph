import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { themeScript } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cartograph",
  description: "Draws a public GitHub repository as a map of what imports what.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The head script rewrites data-theme before React hydrates, so React is told
    // to accept the DOM's value rather than warn about it.
    <html
      lang="en"
      data-theme="system"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="h-full">
        <ClerkProvider
          // Clerk's components read the app's own tokens, so they follow the
          // theme, forced or not, without a second palette to keep in step.
          appearance={{
            variables: {
              colorPrimary: "var(--accent)",
              colorPrimaryForeground: "var(--accent-fg)",
              colorBackground: "var(--surface-raised)",
              colorForeground: "var(--fg)",
              colorMutedForeground: "var(--fg-muted)",
              colorNeutral: "var(--fg)",
              colorBorder: "var(--line)",
              colorInput: "var(--surface)",
              colorInputForeground: "var(--fg)",
              borderRadius: "0.25rem",
            },
          }}
        >
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
