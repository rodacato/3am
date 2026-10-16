type Rgb = [number, number, number];
type SkyStops = { top: Rgb; mid: Rgb; horizon: Rgb };

const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;

const KEYFRAMES: { at: number; sky: SkyStops }[] = [
  { at: 0, sky: { top: hex('#0E131A'), mid: hex('#18202B'), horizon: hex('#28313C') } },
  { at: 0.55, sky: { top: hex('#141B26'), mid: hex('#26303F'), horizon: hex('#4B4A52') } },
  { at: 1, sky: { top: hex('#2A3747'), mid: hex('#5D6672'), horizon: hex('#E39A4F') } },
  { at: 1.6, sky: { top: hex('#5E7690'), mid: hex('#A3A49B'), horizon: hex('#F2C48A') } },
];

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map((i) => Math.round((a[i] as number) + ((b[i] as number) - (a[i] as number)) * t)) as Rgb;
const css = (c: Rgb) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

// 0 is deep night, 1 the moment of sunrise; it keeps brightening after that if the case drags on.
export function dawnProgress(clock: number, beginsAt: number, sunriseAt: number): number {
  return Math.max(0, Math.min(1.6, (clock - beginsAt) / (sunriseAt - beginsAt)));
}

export function skyGradient(progress: number): string {
  const i = Math.max(0, KEYFRAMES.findIndex((k) => k.at >= progress) - 1);
  const a = KEYFRAMES[i] ?? KEYFRAMES[0];
  const b = KEYFRAMES[i + 1] ?? a;
  if (!a || !b) return '';
  const t = b.at === a.at ? 0 : (progress - a.at) / (b.at - a.at);
  const s = { top: mix(a.sky.top, b.sky.top, t), mid: mix(a.sky.mid, b.sky.mid, t), horizon: mix(a.sky.horizon, b.sky.horizon, t) };
  return `linear-gradient(180deg, ${css(s.top)} 0%, ${css(s.mid)} 68%, ${css(s.horizon)} 100%)`;
}
