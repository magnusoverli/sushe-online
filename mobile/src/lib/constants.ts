/**
 * Application constants.
 */

/** Spotify polling interval in ms (headless mobile mode) */
export const POLL_INTERVAL_MOBILE = 3000;

/** Debounce delay for saving reorder operations */
export const REORDER_DEBOUNCE_MS = 500;

/** Long-press duration for drag activation (from design spec) */
export const DRAG_LONG_PRESS_MS = 480;

/** Auto-scroll trigger zone size in px */
export const DRAG_EDGE_ZONE_PX = 60;

/** Max auto-scroll speed in px per frame */
export const DRAG_SCROLL_SPEED_PX = 8;

/** Cover image lazy-load root margin */
export const COVER_OBSERVER_MARGIN = '200px';

/** Max cover upload size in bytes (5MB) */
export const MAX_COVER_SIZE = 5 * 1024 * 1024;

/** Cover resize target dimensions */
export const COVER_RESIZE_PX = 512;

/** Scrobble threshold: 50% of track or 4 minutes */
export const SCROBBLE_THRESHOLD_PERCENT = 0.5;
export const SCROBBLE_THRESHOLD_MS = 4 * 60 * 1000;

/** Haptic vibration duration for drag start */
export const HAPTIC_DURATION_MS = 50;

/**
 * How far into a neighbor card (0–1) the ghost center must reach to trigger
 * a swap.  0.5 = neighbor's midpoint (industry-standard default).
 * Lower values make swaps trigger earlier; higher values require more overlap.
 */
export const DRAG_SWAP_THRESHOLD = 0.25;
