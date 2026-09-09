"use client";

import { useState } from "react";
import type { ViewerApi } from "@/app/viewer/[id]/ViewerCanvas";

interface QuickLookButtonProps {
  api: ViewerApi;
  title: string;
  className: string;
  onError: (message: string) => void;
}

export function QuickLookButton({ api, title, className, onError }: QuickLookButtonProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  const prepare = async () => {
    if (preparing) return;
    setPreparing(true);
    try {
      setUrl(await api.prepareQuickLook());
    } catch (error) {
      onError(error instanceof Error
        ? `Could not prepare iPhone AR: ${error.message}`
        : "Could not prepare iPhone AR. Try a smaller GLB model.");
    } finally {
      setPreparing(false);
    }
  };

  if (url) {
    return (
      <a
        rel="ar"
        href={url}
        download={`${title.replace(/[^a-z0-9-_]+/gi, "-") || "model"}.usdz`}
        className={className}
        title="Open Apple AR Quick Look"
      >
        <img src="/brand/archviz-mark.png" width={16} height={16} alt="" />
        View in your space
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void prepare()}
      disabled={preparing}
      aria-busy={preparing}
      className={className}
      title="Prepare model for Apple AR Quick Look"
    >
      <img src="/brand/archviz-mark.png" width={16} height={16} alt="" />
      {preparing ? "Preparing AR..." : "Prepare AR"}
    </button>
  );
}