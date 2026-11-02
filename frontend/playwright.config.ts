import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const dataDirectory = mkdtempSync(resolve(tmpdir(), "research-studio-e2e-"));
const backendPython = resolve(import.meta.dirname, "../.venv/Scripts/python.exe");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:9321",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `"${backendPython}" -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000`,
      cwd: "..",
      env: { ...process.env, RESEARCH_STUDIO_DATA_DIR: dataDirectory, RESEARCH_STUDIO_EXTRA_CORS_ORIGIN: "http://127.0.0.1:9321" },
      url: "http://127.0.0.1:8000/api/health",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "npm run dev -- --port 9321 --strictPort",
      cwd: ".",
      url: "http://127.0.0.1:9321",
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
