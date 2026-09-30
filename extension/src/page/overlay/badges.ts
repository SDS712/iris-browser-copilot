/** Number badges: an 18 px circle at the top-left of each item. */
import type { Rect } from '../layout';

export const BADGE_SIZE = 18;

export function badgeRect(target: Rect): Rect {
  return {
    x: target.x - BADGE_SIZE / 2,
    y: target.y - BADGE_SIZE / 2,
    width: BADGE_SIZE,
    height: BADGE_SIZE,
  };
}
