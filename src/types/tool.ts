import type { LucideIcon } from "lucide-react";

export interface ToolDefinition {
  slug: string;
  href: `/${string}`;
  name: string;
  shortName?: string;
  description: string;
  category: string;
  highlights: string[];
  icon: LucideIcon;
}

export interface ToolCategoryDefinition {
  name: string;
  icon: LucideIcon;
  /** Tailwind arbitrary color used for accent glow, e.g. "#60a5fa" */
  accentColor?: string;
}
