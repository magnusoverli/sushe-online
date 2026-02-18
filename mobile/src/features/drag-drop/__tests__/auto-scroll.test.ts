import { describe, it, expect, vi } from 'vitest';
import { calcScrollSpeed, startAutoScroll } from '../auto-scroll';

describe('calcScrollSpeed', () => {
  const containerTop = 100;
  const containerBottom = 500;

  it('returns 0 when touch is in the middle of the container', () => {
    expect(calcScrollSpeed(300, containerTop, containerBottom)).toBe(0);
  });

  it('returns negative speed when touch is near top edge', () => {
    // 30px from top = halfway into 60px zone = 50% speed
    const speed = calcScrollSpeed(130, containerTop, containerBottom);
    expect(speed).toBeLessThan(0);
    expect(speed).toBeCloseTo(-4, 0); // ~50% of 8
  });

  it('returns maximum negative speed at the very top', () => {
    const speed = calcScrollSpeed(100, containerTop, containerBottom);
    expect(speed).toBe(-8);
  });

  it('returns positive speed when touch is near bottom edge', () => {
    // 30px from bottom = halfway into 60px zone = 50% speed
    const speed = calcScrollSpeed(470, containerTop, containerBottom);
    expect(speed).toBeGreaterThan(0);
    expect(speed).toBeCloseTo(4, 0); // ~50% of 8
  });

  it('returns maximum positive speed at the very bottom', () => {
    const speed = calcScrollSpeed(500, containerTop, containerBottom);
    expect(speed).toBe(8);
  });

  it('returns 0 when touch is just outside the trigger zone', () => {
    // 61px from top edge (just outside 60px zone)
    expect(calcScrollSpeed(161, containerTop, containerBottom)).toBe(0);
    // 61px from bottom edge
    expect(calcScrollSpeed(439, containerTop, containerBottom)).toBe(0);
  });

  it('returns 0 when touch is exactly at zone boundary', () => {
    // 60px from top = ratio = 0
    const speed = calcScrollSpeed(160, containerTop, containerBottom);
    expect(speed).toBe(0);
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
