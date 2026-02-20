import { describe, it, expect, vi } from 'vitest';
import {
  calcScrollSpeed,
  effectiveEdgeZone,
  startAutoScroll,
} from '../auto-scroll';

describe('effectiveEdgeZone', () => {
  it('returns the proportional zone for typical container heights', () => {
    // 800px * 0.1 = 80px (capped at max 80)
    expect(effectiveEdgeZone(800)).toBe(80);
  });

  it('clamps to minimum for very small containers', () => {
    // 200px * 0.1 = 20px, but min is 40
    expect(effectiveEdgeZone(200)).toBe(40);
  });

  it('clamps to maximum for very tall containers', () => {
    // 1200px * 0.1 = 120px, but max is 80
    expect(effectiveEdgeZone(1200)).toBe(80);
  });

  it('uses proportional value in the middle range', () => {
    // 600px * 0.1 = 60px (between 40 min and 80 max)
    expect(effectiveEdgeZone(600)).toBe(60);
  });
});

describe('calcScrollSpeed', () => {
  // Container: top=100, bottom=700, height=600 → edgeZone = 60px
  // Max speed = 12 px/frame
  const containerTop = 100;
  const containerBottom = 700;

  it('returns 0 when touch is in the middle of the container', () => {
    expect(calcScrollSpeed(400, containerTop, containerBottom)).toBe(0);
  });

  it('returns negative speed when touch is near top edge', () => {
    // 30px from top = halfway into 60px zone = 50% speed
    const speed = calcScrollSpeed(130, containerTop, containerBottom);
    expect(speed).toBeLessThan(0);
    expect(speed).toBeCloseTo(-6, 0); // ~50% of 12
  });

  it('returns maximum negative speed at the very top', () => {
    const speed = calcScrollSpeed(100, containerTop, containerBottom);
    expect(speed).toBe(-12);
  });

  it('returns max negative speed when touch is above container', () => {
    // Dragging into header/safe area above the container → max scroll-up
    const speed = calcScrollSpeed(50, containerTop, containerBottom);
    expect(speed).toBe(-12);
  });

  it('returns positive speed when touch is near bottom edge', () => {
    // 30px from bottom = halfway into 60px zone = 50% speed
    const speed = calcScrollSpeed(670, containerTop, containerBottom);
    expect(speed).toBeGreaterThan(0);
    expect(speed).toBeCloseTo(6, 0); // ~50% of 12
  });

  it('returns maximum positive speed at the very bottom', () => {
    const speed = calcScrollSpeed(700, containerTop, containerBottom);
    expect(speed).toBe(12);
  });

  it('returns 0 when touch is just outside the top trigger zone', () => {
    // 61px from top edge (just outside 60px zone)
    expect(calcScrollSpeed(161, containerTop, containerBottom)).toBe(0);
  });

  it('returns 0 when touch is just outside the bottom trigger zone', () => {
    // 61px from bottom edge
    expect(calcScrollSpeed(639, containerTop, containerBottom)).toBe(0);
  });

  it('returns 0 when touch is exactly at zone boundary', () => {
    // 60px from top = ratio = 0
    const speed = calcScrollSpeed(160, containerTop, containerBottom);
    expect(speed).toBe(0);
  });

  it('uses proportional zones for small containers', () => {
    // Container: top=0, bottom=300, height=300 → edgeZone = max(40, min(30, 80)) = 40px
    // Touch at 20px from top = halfway into 40px zone = 50% speed
    const speed = calcScrollSpeed(20, 0, 300);
    expect(speed).toBeLessThan(0);
    expect(speed).toBeCloseTo(-6, 0); // ~50% of 12
  });
});

describe('startAutoScroll', () => {
  it('calls requestAnimationFrame to start the loop', () => {
    const container = { scrollTop: 0 } as HTMLElement;
    const rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation(() => 1);
    const cafSpy = vi
      .spyOn(globalThis, 'cancelAnimationFrame')
      .mockImplementation(() => {});

    const stop = startAutoScroll(container, () => 5);

    expect(rafSpy).toHaveBeenCalled();

    stop();
    expect(cafSpy).toHaveBeenCalled();

    rafSpy.mockRestore();
    cafSpy.mockRestore();
  });

  it('scrolls the container by the speed on each tick', () => {
    const container = { scrollTop: 100 } as HTMLElement;
    let tickFn: FrameRequestCallback | undefined;

    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      if (!tickFn) tickFn = cb;
      return 1;
    });
    const cafSpy = vi
      .spyOn(globalThis, 'cancelAnimationFrame')
      .mockImplementation(() => {});

    const stop = startAutoScroll(container, () => 3);

    // Simulate one animation frame
    tickFn!(0);
    expect(container.scrollTop).toBe(103);

    stop();

    vi.spyOn(globalThis, 'requestAnimationFrame').mockRestore();
    cafSpy.mockRestore();
  });
});
