import type { Metadata } from "next";
import { getToolBySlug } from "@/config/tools";

const tool = getToolBySlug("video-merger");

export const metadata: Metadata = {
  title: tool?.name ?? "Video Merger",
  description: tool?.description,
};

export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
