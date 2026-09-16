"use client";

import { useEffect, useState } from "react";
import type { ViewerApi } from "@/app/viewer/[id]/ViewerCanvas";

interface QuickLookButtonProps {
  api: ViewerApi;
  title: string;
  className: string;
  onError: (message: string) => void;
}

export function QuickLookButton({ api, title, className, onError }: QuickLookButtonProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setPreparing(true);
    setUrl(null);
    void api.prepareQuickLook().then((result) => {
      if (active) setUrl(result);
    }).catch((error: unknown) => {
      if (active) onError(error instanceof Error
        ? `Could not prepare iPhone AR: ${error.message}`
        : "Could not prepare iPhone AR. Try a smaller GLB model.");
    }).finally(() => {
      if (active) setPreparing(false);
    });
    return () => { active = false; };
  }, [api, attempt, onError]);

  if (url) {
    return (
      <span className={`${className} relative`}>
        <img src="/brand/archviz-mark.png" width={16} height={16} alt="" />
        <span aria-hidden="true">View in your space</span>
        <a
          rel="ar"
          href={url}
          download={`${title.replace(/[^a-z0-9-_]+/gi, "-") || "model"}.usdz`}
          className="ring-focus absolute inset-0 rounded-[inherit]"
          aria-label="View in your space"
          title="Open Apple AR Quick Look"
        >
          <img src="/brand/archviz-mark.png" width={16} height={16} alt="" className="h-full w-full opacity-0" />
        </a>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setAttempt((value) => value + 1)}
      disabled={preparing}
      aria-busy={preparing}
      className={className}
      title="Prepare model for Apple AR Quick Look"
    >
      <img src="/brand/archviz-mark.png" width={16} height={16} alt="" />
      {preparing ? "Preparing AR..." : "Retry AR"}
    </button>
  );
}