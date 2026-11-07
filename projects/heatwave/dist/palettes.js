export const palettes = {
  ember: [[0, [7, 8, 25]], [.20, [44, 19, 83]], [.40, [129, 25, 100]], [.60, [219, 51, 43]], [.78, [250, 134, 35]], [.92, [255, 223, 117]], [1, [255, 250, 220]]],
  arctic: [[0, [3, 10, 24]], [.23, [14, 40, 95]], [.46, [21, 103, 170]], [.67, [27, 193, 208]], [.85, [158, 242, 225]], [1, [239, 255, 247]]],
  spectrum: [[0, [12, 10, 58]], [.20, [52, 43, 163]], [.37, [18, 141, 201]], [.53, [49, 200, 116]], [.70, [231, 230, 54]], [.85, [252, 114, 32]], [1, [244, 242, 222]]],
  mono: [[0, [6, 9, 12]], [.5, [111, 121, 128]], [1, [248, 248, 235]]]
};

export function makeLut(palette, contrast = 1.15, exposure = 0, invert = false) {
  const stops = palettes[palette] || palettes.ember;
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    let t = Math.min(1, Math.max(0, (i / 255 - .5) * contrast + .5 + exposure));
    if (invert) t = 1 - t;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const a = stops[k], b = stops[k + 1], f = (t - a[0]) / (b[0] - a[0]);
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = a[1][c] + (b[1][c] - a[1][c]) * f;
  }
  return lut;
}
