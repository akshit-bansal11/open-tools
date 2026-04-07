import type { Metadata } from "next";
import { getToolBySlug } from "@/config/tools";

const tool = getToolBySlug("pdf-splitter");

export const metadata: Metadata = {
  title: tool?.name ?? "PDF Splitter",
  description: tool?.description,
};

export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
