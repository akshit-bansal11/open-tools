import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { RepositoryCorner } from "@/components/common/RepositoryCorner";
import { SiteFooter } from "@/components/ui/layout/SiteFooter";

interface ToolPageShellProps {
  title: string;
  description: string;
  children: ReactNode;
  /** @deprecated — accent colors are no longer applied to tool pages */
  accentColor?: string;
}

export function ToolPageShell({
  title,
  description,
  children,
}: ToolPageShellProps) {
  return (
    <div className="page-shell">
      <div className="page-grid-overlay" />

      <RepositoryCorner className="fixed right-0 top-0 z-20 p-2 sm:p-3" />

      <main className="page-main relative z-10">
        <div className="mb-4 flex justify-start">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="glass-button"
          >
            <Link href="/">
              <ArrowLeft className="size-4" />
              All tools
            </Link>
          </Button>
        </div>

        <header className="mb-8 text-center">
          <h1 className="text-7xl font-semibold tracking-tight text-foreground sm:text-8xl">
            {title}
          </h1>
          {description && (
            <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
              {description}
            </p>
          )}
        </header>

        {children}

        <SiteFooter className="mt-12 border-t border-white/5 pt-8" />
      </main>
    </div>
  );
}
