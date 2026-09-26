import { useEffect, useRef, useState } from "react";
import type { NationViewModel } from "../application/nation-view";
import {
  createSpriteAtlas,
  createSpritePool,
  drawMotionFrame,
  initialQualityTier,
  nextQualityTier,
  MOTION_HEIGHT,
  MOTION_WIDTH,
  type QualityTier,
} from "./nation-motion";

type QualitySetting = "auto" | QualityTier;

function deviceTier(): QualityTier {
  const memory = (navigator as Navigator & { deviceMemory?: number })
    .deviceMemory;
  return initialQualityTier(navigator.hardwareConcurrency, memory);
}

function prefersReducedMotion() {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  );
}

export function NationMotion({ model }: { model: NationViewModel }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [setting, setSetting] = useState<QualitySetting>("auto");
  const [autoTier, setAutoTier] = useState(deviceTier);
  const [reduced, setReduced] = useState(prefersReducedMotion);
  const [fps, setFps] = useState<number | null>(null);
  const tier = setting === "auto" ? autoTier : setting;

  useEffect(() => {
    const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!preference) return;
    const update = () => setReduced(preference.matches);
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (reduced || !canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const atlas = createSpriteAtlas();
    const pool = createSpritePool();
    let frameId = 0;
    let lastDraw = 0;
    let sampleStart = 0;
    let sampleFrames = 0;
    let intersects = true;

    const stop = () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      frameId = 0;
      lastDraw = 0;
    };
    const frame = (time: number) => {
      frameId = 0;
      if (document.hidden || !intersects) return;
      if (!lastDraw || time - lastDraw >= 1000 / 30 - 2) {
        drawMotionFrame(
          context,
          atlas,
          pool,
          model,
          tier,
          lastDraw ? (time - lastDraw) / 1000 : 0,
        );
        lastDraw = time;
        if (!sampleStart) sampleStart = time;
        sampleFrames += 1;
        if (time - sampleStart >= 2000) {
          const measured = Math.round(
            (sampleFrames * 1000) / (time - sampleStart),
          );
          setFps(measured);
          if (setting === "auto")
            setAutoTier((current) => nextQualityTier(current, measured));
          sampleStart = time;
          sampleFrames = 0;
        }
      }
      frameId = window.requestAnimationFrame(frame);
    };
    const start = () => {
      if (!frameId && !document.hidden && intersects)
        frameId = window.requestAnimationFrame(frame);
    };
    const visibilityChanged = () => {
      if (document.hidden) stop();
      else start();
    };
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            intersects = entry?.isIntersecting ?? false;
            if (intersects) start();
            else stop();
          });
    observer?.observe(canvas);
    document.addEventListener("visibilitychange", visibilityChanged);
    start();
    return () => {
      stop();
      observer?.disconnect();
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [model, reduced, tier, setting]);

  return (
    <>
      {!reduced && (
        <canvas
          ref={canvasRef}
          className="nation-motion-canvas"
          width={MOTION_WIDTH}
          height={MOTION_HEIGHT}
          aria-hidden="true"
          data-quality={tier}
        />
      )}
      <div className="nation-motion-controls">
        <label>
          景観の画質
          <select
            value={setting}
            onChange={(event) =>
              setSetting(event.target.value as QualitySetting)
            }
          >
            <option value="auto">自動</option>
            <option value="high">高</option>
            <option value="medium">標準</option>
            <option value="low">軽量</option>
          </select>
        </label>
        <output className="nation-motion-diagnostics" aria-live="off">
          {reduced
            ? "動きの軽減: 静止表示"
            : `画質 ${tier} · 描画 ${fps === null ? "計測中" : `${fps}fps`}`}
        </output>
      </div>
    </>
  );
}
