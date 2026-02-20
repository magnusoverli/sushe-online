/**
 * Auto-scroll logic for drag-and-drop.
 *
 * When dragging near the top or bottom edge of the scroll container,
 * smoothly scrolls the container in that direction.
 *
 * Spec:
 * - Proportional trigger zones (10% of container, 40–80px)
 * - Top zone extends above container (into header/safe area)
 * - 12px/frame max speed
 * - Speed proportional to distance into the trigger zone
 * - Uses requestAnimationFrame loop on the scroll container
 */

import {
  DRAG_EDGE_ZONE_PX,
  DRAG_EDGE_ZONE_MAX_PX,
  DRAG_EDGE_ZONE_RATIO,
  DRAG_SCROLL_SPEED_PX,
} from '@/lib/constants';

export interface AutoScrollState {
  rafId: number | null;
  speed: number;
}

/**
 * Compute the effective trigger zone size for auto-scroll.
 *
 * On devices with heavy browser chrome (e.g. Vivaldi on Android), the scroll
 * container may be significantly shorter than expected, making fixed 60px
 * zones disproportionately large. This uses a percentage of the container
 * height (clamped between the fixed minimum and a max cap) so the zones
 * scale with the available space.
 */
export function effectiveEdgeZone(containerHeight: number): number {
  const proportional = containerHeight * DRAG_EDGE_ZONE_RATIO;
  // Clamp: at least DRAG_EDGE_ZONE_PX, at most DRAG_EDGE_ZONE_MAX_PX
  return Math.max(
    DRAG_EDGE_ZONE_PX,
    Math.min(proportional, DRAG_EDGE_ZONE_MAX_PX)
  );
}

/**
 * Calculate the scroll speed based on the touch Y position relative
 * to the scroll container bounds.
 *
 * Top zone: triggers when the touch is within `edgeZone` px of the
 * container top, OR above it (dragging into the header/safe area).
 * Dragging above the container gives max scroll-up speed — the user
 * clearly wants to scroll up and shouldn't have to hunt for a narrow
 * pixel band between the header and the zone boundary.
 *
 * Bottom zone: triggers when the touch is within `edgeZone` px of the
 * container bottom. Positions below the container are ignored (the
 * tab bar acts as a natural boundary).
 *
 * @returns Positive = scroll down, negative = scroll up, 0 = no scroll
 */
export function calcScrollSpeed(
  touchY: number,
  containerTop: number,
  containerBottom: number
): number {
  const containerHeight = containerBottom - containerTop;
  const edgeZone = effectiveEdgeZone(containerHeight);

  const distFromTop = touchY - containerTop;
  const distFromBottom = containerBottom - touchY;

  if (distFromTop < edgeZone) {
    // Near or above top edge: scroll up (negative speed).
    // Above the container (distFromTop < 0) → max speed.
    const ratio = Math.min(1, 1 - distFromTop / edgeZone);
    return -ratio * DRAG_SCROLL_SPEED_PX;
  }

  if (distFromBottom < edgeZone && distFromBottom >= 0) {
    // Near bottom edge: scroll down (positive speed)
    const ratio = 1 - distFromBottom / edgeZone;
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
