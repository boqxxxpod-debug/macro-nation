import { useState } from "react";
import { expertPortraitManifest } from "@macro-nation/advisor-core";

/** Asset paths stay relative in content; the web adapter owns the deployment base. */
export function ExpertPortrait({ expertId }: { expertId: string }) {
  const portrait = expertPortraitManifest.find(
    (item) => item.expertId === expertId,
  );
  const [failedSource, setFailedSource] = useState<string | null>(null);
  if (!portrait || failedSource === portrait.src) {
    return (
      <span
        className="expert-portrait expert-portrait-fallback"
        role="img"
        aria-label={`${portrait?.altText ?? "専門家の画像"}（画像を表示できません）`}
      >
        <span aria-hidden="true">画像なし</span>
      </span>
    );
  }
  const base = import.meta.env.BASE_URL;
  return (
    <span className="expert-portrait">
      <img
        src={`${base}${portrait.src}`}
        srcSet={`${base}${portrait.src} 1x, ${base}${portrait.src2x} 2x`}
        width={128}
        height={128}
        alt={portrait.altText}
        onError={() => setFailedSource(portrait.src)}
      />
    </span>
  );
}
