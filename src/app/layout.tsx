import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { DevAgentSidebar } from "@/components/dev/DevAgentSidebar";
import { isDevAgentEnabled } from "@/lib/env";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SF Side Quest — Fix the City",
  description: "Neighborhood quests generated from real SF 311 reports by a Mistral agent over Elasticsearch.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        {isDevAgentEnabled() && <DevAgentSidebar />}
      </body>
    </html>
  );
}
