// tool.ts
// Shared type definitions for tool and category registry entries.

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
  accentColor?: string;
}
