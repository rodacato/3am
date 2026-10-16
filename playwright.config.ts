import { defineConfig } from '@playwright/test';

// Tests run against the production build (npm run e2e builds first) so relative paths and the worker bundle are exercised.
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:5318/', viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
  webServer: {
    command: 'npx vite preview --port 5318 --strictPort',
    url: 'http://localhost:5318/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
