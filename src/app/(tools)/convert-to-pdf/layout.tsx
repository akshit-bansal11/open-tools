import type { Metadata } from "next";
import { getToolBySlug } from "@/config/tools";

const tool = getToolBySlug("convert-to-pdf");

export const metadata: Metadata = {
  title: tool?.name ?? "Convert to PDF",
  description: tool?.description,
};

export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
