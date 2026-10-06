import { describe, expect, it } from 'vitest';
import { heightAt } from '../client/terrain.js';

// Captured from the terrain before the flat-area CPU optimization. Include points immediately
// outside flat masks: shortcuts must not flatten their shoulders, the lake, mountains or Azkaban.
const HEIGHTS: [number, number, number][] = [
  [0, -22, 0], [-66, -73, 0], [74, 38, 0.4622606891241366],
  [-80, -100, 0], [-80.0001, -100, -4.130205170769492e-11],
  [-80.1, -100, -0.000041359188797681775], [-90, -100, -0.5859173637400819],
  [-98, -100, -0.8420101263801969], [7, 90, 0.00629838035910282], [12, 90, 0.18332622845366528],
  [-118, 40, -5], [-112, 40, -5], [-88, 40, -0.09349498985508854], [-70, 62, -0.4869368442991523],
  [95, 30, 0], [109, 30, 0], [109.01, 30, 5.16181158515112e-7], [156, 52, 1.8153136722997196],
  [40, -150, 0], [85, -150, 0], [85.001, -150, 9.481955032408515e-9],
  [0, 172, 0], [55, 172, 0], [71, 172, 0.2211351528973613],
  [300, -200, 31.794814401885002], [-800, -900, 63.932114405433595], [0, 330, -25.85123839863526],
  [0, 420, 0.3], [20, 420, -2.5580781048989247], [36, 420, -27.293034089930586],
];

describe('terrain preserves its heightfield when skipping flat-area noise', () => {
  it.each(HEIGHTS)('keeps the ground at (%s, %s)', (x, z, height) => {
    expect(heightAt(x, z)).toBeCloseTo(height, 13);
  });
});
