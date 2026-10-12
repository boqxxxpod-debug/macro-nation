import { SCENE_HEIGHT, SCENE_WIDTH } from "./nation-motion-paths";

/** Matches CSS object-fit: cover and object-position: 50% 15%. */
export function structureViewBox(width: number, height: number) {
  if (width <= 0 || height <= 0) return `0 0 ${SCENE_WIDTH} ${SCENE_HEIGHT}`;
  const scale = Math.max(width / SCENE_WIDTH, height / SCENE_HEIGHT);
  const visibleWidth = width / scale;
  const visibleHeight = height / scale;
  const x = (SCENE_WIDTH - visibleWidth) * 0.5;
  const y = (SCENE_HEIGHT - visibleHeight) * 0.15;
  return `${x} ${y} ${visibleWidth} ${visibleHeight}`;
}
