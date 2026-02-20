/**
 * Auto-scroll logic for drag-and-drop.
 *
 * When dragging near the top or bottom edge of the scroll container,
 * smoothly scrolls the container in that direction.
 *
 * Spec:
 * - 60px trigger zone at top and bottom
 * - 8px/frame max speed
 * - Speed proportional to distance into the trigger zone
 * - Uses requestAnimationFrame loop on the scroll container
 */

import { DRAG_EDGE_ZONE_PX, DRAG_SCROLL_SPEED_PX } from '@/lib/constants';

export interface AutoScrollState {
  rafId: number | null;
  speed: number;
}

/**
 * Calculate the scroll speed based on the touch Y position relative
 * to the scroll container bounds.
 *
 * @returns Positive = scroll down, negative = scroll up, 0 = no scroll
 */
export function calcScrollSpeed(
  touchY: number,
  containerTop: number,
  containerBottom: number
): number {
  const distFromTop = touchY - containerTop;
  const distFromBottom = containerBottom - touchY;

  if (distFromTop < DRAG_EDGE_ZONE_PX && distFromTop >= 0) {
    // Near top edge: scroll up (negative speed)
    const ratio = 1 - distFromTop / DRAG_EDGE_ZONE_PX;
    return -ratio * DRAG_SCROLL_SPEED_PX;
  }

  if (distFromBottom < DRAG_EDGE_ZONE_PX && distFromBottom >= 0) {
    // Near bottom edge: scroll down (positive speed)
    const ratio = 1 - distFromBottom / DRAG_EDGE_ZONE_PX;
    return ratio * DRAG_SCROLL_SPEED_PX;
  }

  return 0;
}

/**
 * Start the auto-scroll RAF loop.
 * Returns a cleanup function to stop it.
 */
export function startAutoScroll(
  container: HTMLElement,
  getSpeed: () => number
): () => void {
  let rafId: number | null = null;
  let running = true;

  function tick() {
    if (!running) return;
    const speed = getSpeed();
    if (speed !== 0) {
      container.scrollTop += speed;
    }
    rafId = requestAnimationFrame(tick);
  }

  rafId = requestAnimationFrame(tick);

  return () => {
    running = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
    }
  };
}
