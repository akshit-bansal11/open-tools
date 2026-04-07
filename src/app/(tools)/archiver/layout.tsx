import type { Metadata } from "next";
import { getToolBySlug } from "@/config/tools";

const tool = getToolBySlug("archiver");

export const metadata: Metadata = {
  title: tool?.name ?? "Archiver",
  description: tool?.description,
};

export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
