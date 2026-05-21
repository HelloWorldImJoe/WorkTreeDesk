#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const [, , channelArg, tauriCommand, ...extraArgs] = process.argv;
const channel = normalizeChannel(channelArg);

if (!channel) {
  fail("Missing channel. Use stable or preview.");
}

if (!tauriCommand) {
  fail("Missing tauri command. Example: dev or build.");
}

const tauriArgs = ["tauri", tauriCommand, ...extraArgs];
if (channel === "preview") {
  tauriArgs.push("--config", "src-tauri/tauri.preview.conf.json");
}

const result = spawnSync(resolveNpxCommand(), tauriArgs, {
  cwd: repoRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    WORKTREEDESK_CHANNEL: channel,
  },
});

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);

function normalizeChannel(value) {
  const channel = String(value || "").trim().toLowerCase();
  if (channel === "stable" || channel === "preview") {
    return channel;
  }
  return "";
}

function resolveNpxCommand() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}