/**
 * How fast an animated background may be drawn. A computer without a good graphics card (or a busy one) needs longer
 * for one picture than the 33 ms of 30 pictures a second: asking for the next picture before the last one is done
 * freezes the whole window. So the next picture waits twice as long as the last one took, and the page keeps room
 * for everything else.
 */
const state = { cost: 0 };

/** Remembers how long drawing a picture took (smoothed). */
export function recordPaint(milliseconds: number): void {
  state.cost = state.cost === 0 ? milliseconds : state.cost * 0.7 + milliseconds * 0.3;
}

/** The least time between two pictures of an animation, in milliseconds. */
export function minFrameGap(): number {
  return Math.min(500, Math.max(33, state.cost * 2));
}
