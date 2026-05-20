export interface SidebarMoreMenuAnchorRect {
  bottom: number;
  left: number;
  right: number;
}

export interface SidebarMoreMenuLayout {
  left: number;
  top: number;
  width: number;
}

export function deriveSidebarMoreMenuLayout(params: {
  anchorRect: SidebarMoreMenuAnchorRect;
  viewportWidth: number;
  menuWidth?: number;
  margin?: number;
  verticalOffset?: number;
}): SidebarMoreMenuLayout {
  const width = params.menuWidth ?? 144;
  const margin = params.margin ?? 8;
  const verticalOffset = params.verticalOffset ?? 5;
  const maxLeft = Math.max(margin, params.viewportWidth - width - margin);

  // 默认从 more 按钮左边缘往右展开；只有右侧放不下时，才翻到按钮左侧。
  const preferredLeft = params.anchorRect.left + width <= params.viewportWidth - margin
    ? params.anchorRect.left
    : params.anchorRect.right - width;
  const left = Math.min(Math.max(margin, preferredLeft), maxLeft);

  return {
    left,
    top: params.anchorRect.bottom + verticalOffset,
    width
  };
}
