// Records the README demo from the production build: npm run demo. The steps live in demo-tour.mjs.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import * as course from './demo-tour.mjs';

const PORT = 5399;
const URL = `http://localhost:${PORT}/`;
const VIEWPORT = { width: 1440, height: 900 };
const RAW_DIR = 'test-results/demo';
const OUT_DIR = 'docs/media';

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt++) {
    const response = await fetch(URL).catch(() => null);
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`vite preview did not answer on ${URL}`);
}

// The GIF is cut from the MP4, not the raw WebM: the WebM's compression noise doubles the GIF's size.
function encode(video, skipSeconds) {
  const quiet = ['-y', '-loglevel', 'error'];
  const mp4 = `${OUT_DIR}/demo.mp4`;
  execFileSync('ffmpeg', [...quiet, '-ss', skipSeconds.toFixed(2), '-i', video, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26', '-movflags', '+faststart', mp4]);
  const palette = 'fps=9,scale=840:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle';
  execFileSync('ffmpeg', [...quiet, '-i', mp4, '-vf', palette, `${OUT_DIR}/demo.gif`]);
}

const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
try {
  await waitForServer();
  await rm(RAW_DIR, { recursive: true, force: true });
  const browser = await chromium.launch(course.launchOptions);
  const context = await browser.newContext({ viewport: VIEWPORT, locale: 'en-US', recordVideo: { dir: RAW_DIR, size: VIEWPORT } });
  const page = await context.newPage();
  await course.prepare?.(page);
  const started = Date.now();
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.evaluate(() => document.fonts.ready);
  const skipSeconds = (Date.now() - started) / 1000;

  await course.default(page);

  const video = await page.video().path();
  await context.close();
  await browser.close();
  await mkdir(OUT_DIR, { recursive: true });
  encode(video, skipSeconds);
  console.log(`Wrote ${OUT_DIR}/demo.mp4 and ${OUT_DIR}/demo.gif`);
} finally {
  server.kill();
}
