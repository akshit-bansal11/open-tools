// GeminiApiKeyDialog.tsx
// Global dialog component for configuring and storing the Gemini API key.

"use client";

import { useState } from "react";
import { ExternalLink, KeyRound, X } from "lucide-react";
import { Button } from "@/components/ui/interaction/Button";
import { Card } from "@/components/ui/layout/Card";
import { Label } from "@/components/ui/form/Label";
import { Input } from "@/components/ui/form/Input";

interface GeminiApiKeyDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (value: string) => void;
}

export function GeminiApiKeyDialog({
  open,
  onClose,
  onSave,
}: GeminiApiKeyDialogProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  if (!open) {
    return null;
  }

  function handleDismiss() {
    setValue("");
    setError("");
    onClose();
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!value.trim()) {
      setError("API key cannot be empty.");
      return;
    }

    onSave(value.trim());
    setValue("");
    setError("");
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
      onClick={handleDismiss}
    >
      <Card
        className="w-full max-w-lg gap-0 border-white/10 bg-card/95 p-0 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b px-6 py-5">
          <div>
            <div className="inline-flex rounded-2xl border bg-background/70 p-3">
              <KeyRound className="size-5" />
            </div>
            <h2 className="mt-4 text-xl font-semibold">
              Gemini API Key Required
            </h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              Palette extraction runs in your browser and stores your Gemini key
              in local storage, matching the original color-space flow.
            </p>
          </div>

          <Button variant="ghost" size="icon" onClick={handleDismiss}>
            <X className="size-4" />
          </Button>
        </div>

        <form className="space-y-4 px-6 py-5" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="gemini-api-key">API Key</Label>
            <Input
              id="gemini-api-key"
              type="password"
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                if (error) {
                  setError("");
                }
              }}
              placeholder="Paste your Gemini API key"
              autoComplete="off"
              className="h-11"
            />
            {error ? (
              <p className="text-sm text-red-300">{error}</p>
            ) : (
              <p className="text-xs leading-5 text-muted-foreground">
                The key never leaves your browser except for direct Gemini API
                requests you initiate from this page.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
            >
              Get a Gemini key
              <ExternalLink className="size-3.5" />
            </a>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" onClick={handleDismiss}>
                Close
              </Button>
              <Button type="submit">Save Key</Button>
            </div>
          </div>
        </form>
      </Card>
    </div>
  );
}
