export const SIDEBAR_WIDTH_MIN = 200;
export const SIDEBAR_WIDTH_MAX = 360;
export const SIDEBAR_WIDTH_KEYBOARD_STEP = 10;

export function clampSidebarWidth(width: number): number {
  return clamp(Math.round(width), SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX);
}

export function deriveSidebarWidthFromDrag(input: {
  startWidth: number;
  startClientX: number;
  currentClientX: number;
}): number {
  return clampSidebarWidth(input.startWidth + input.currentClientX - input.startClientX);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
