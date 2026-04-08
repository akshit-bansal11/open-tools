// OutputField.tsx
// Read-only text area with an integrated copy button for design tool outputs.

import { CopyButton } from "@/components/ui/design/CopyButton";
import { Label } from "@/components/ui/form/Label";
import { cn } from "@/lib/utils";

interface OutputFieldProps {
  label: string;
  value: string;
  description?: string;
  className?: string;
  valueClassName?: string;
}

export function OutputField({
  label,
  value,
  description,
  className,
  valueClassName,
}: OutputFieldProps) {
  return (
    <div className={cn("tool-card p-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Label className="block">{label}</Label>
          {description ? (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        <CopyButton value={value} />
      </div>
      <pre
        className={cn(
          "surface-inset mt-4 overflow-x-auto p-4 font-mono text-sm whitespace-pre-wrap break-all text-white/80",
          valueClassName,
        )}
      >
        {value}
      </pre>
    </div>
  );
}
