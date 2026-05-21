#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const releaseTypes = new Set(["patch", "minor", "major"]);
const releaseChannels = new Set(["stable", "preview"]);
const args = process.argv.slice(2);
const showHelp = args.includes("--help") || args.includes("-h");
const dryRun = args.includes("--dry-run");
const releaseChannel = readChannel(args);
const releaseType = readReleaseType(args);

const trackedFiles = {
  packageJson: path.join(repoRoot, "package.json"),
  packageLock: path.join(repoRoot, "package-lock.json"),
  cargoToml: path.join(repoRoot, "src-tauri", "Cargo.toml"),
  cargoLock: path.join(repoRoot, "src-tauri", "Cargo.lock"),
  tauriConfig: path.join(repoRoot, "src-tauri", "tauri.conf.json"),
};

if (showHelp) {
  printHelp();
  process.exit(0);
}

if (!releaseTypes.has(releaseType)) {
  fail(`Unsupported release type: ${releaseType}. Use patch, minor, or major.`);
}

if (!releaseChannels.has(releaseChannel)) {
  fail(`Unsupported release channel: ${releaseChannel}. Use stable or preview.`);
}

ensureGitRepository();
if (!dryRun) {
  ensureNoPreStagedChanges();
  ensureVersionFilesAreClean();
}

const versions = readVersions();
ensureVersionsAreAligned(versions);

const currentVersion = versions.packageJson;
const nextVersion = bumpVersion(currentVersion, releaseType, releaseChannel);
const tagName = `v${nextVersion}`;
const currentBranch = readStdout(["branch", "--show-current"]);
const upstream = readOptionalStdout(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
const { remoteName, remoteBranch } = resolvePushTarget(upstream, currentBranch);

ensureTagDoesNotExist(tagName);

if (dryRun) {
  log(`Dry run (${releaseChannel}): ${currentVersion} -> ${nextVersion}`);
  log(`Would commit on branch ${currentBranch} and push to ${remoteName}/${remoteBranch}`);
  process.exit(0);
}

writeVersions(nextVersion);

runGit(["add", ...Object.values(trackedFiles).map((filePath) => path.relative(repoRoot, filePath))]);
runGit(["commit", "-m", `chore(release): ${tagName}`]);
runGit(["tag", "-a", tagName, "-m", `Release ${tagName}`]);
runGit(["push", remoteName, `${currentBranch}:${remoteBranch}`]);
runGit(["push", remoteName, tagName]);

log(`Release completed (${releaseChannel}): ${currentVersion} -> ${nextVersion}`);

function printHelp() {
  console.log(`Usage: node scripts/release.mjs [patch|minor|major] [--dry-run]\n\n` +
    `Options:\n` +
    `  --channel stable|preview   Release channel, defaults to stable\n\n` +
    `Examples:\n` +
    `  npm run release\n` +
    `  npm run release:minor\n` +
    `  npm run release:major\n` +
    `  npm run release:preview\n` +
    `  node scripts/release.mjs minor --dry-run`);
}

function readChannel(rawArgs) {
  const flag = rawArgs.find((arg) => arg.startsWith("--channel="));
  if (flag) {
    return flag.slice("--channel=".length).trim().toLowerCase() || "stable";
  }

  const channelFlagIndex = rawArgs.indexOf("--channel");
  if (channelFlagIndex >= 0) {
    return String(rawArgs[channelFlagIndex + 1] || "").trim().toLowerCase() || "stable";
  }

  return "stable";
}

function readReleaseType(rawArgs) {
  const positionalArgs = rawArgs.filter((arg, index) => {
    if (arg.startsWith("-")) {
      return false;
    }

    if (rawArgs[index - 1] === "--channel") {
      return false;
    }

    return !releaseChannels.has(arg.toLowerCase());
  });

  return positionalArgs[0] ?? "patch";
}

function ensureGitRepository() {
  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (result.status !== 0 || result.stdout.trim() !== "true") {
    fail("Current directory is not a git repository.");
  }
}

function ensureNoPreStagedChanges() {
  const staged = readOptionalStdout(["diff", "--cached", "--name-only"]);
  if (staged) {
    fail("Detected pre-staged changes. Please commit or unstage them before running release.");
  }
}

function ensureVersionFilesAreClean() {
  const fileArgs = Object.values(trackedFiles).map((filePath) => path.relative(repoRoot, filePath));
  const changed = readOptionalStdout(["diff", "--name-only", "--", ...fileArgs]);
  if (changed) {
    fail("Version files already contain local changes. Please commit or discard them before running release.");
  }
}

function readVersions() {
  const packageJson = readJson(trackedFiles.packageJson).version;
  const packageLockJson = readJson(trackedFiles.packageLock);
  const packageLock = packageLockJson.version;
  const packageLockRoot = packageLockJson.packages?.[""]?.version;
  const tauriConfig = readJson(trackedFiles.tauriConfig).version;
  const cargoToml = readCargoTomlVersion(trackedFiles.cargoToml);
  const cargoLock = readCargoLockVersion(trackedFiles.cargoLock);

  return {
    packageJson,
    packageLock,
    packageLockRoot,
    cargoToml,
    cargoLock,
    tauriConfig,
  };
}

function ensureVersionsAreAligned(versions) {
  const uniqueVersions = new Set(Object.values(versions));
  if (uniqueVersions.size !== 1) {
    fail(`Version fields are not aligned: ${JSON.stringify(versions, null, 2)}`);
  }
}

function bumpVersion(version, type, channel) {
  const parsed = parseVersion(version);
  if (channel === "preview") {
    return bumpPreviewVersion(parsed, type);
  }

  return bumpStableVersion(parsed, type);
}

function parseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-preview\.(\d+))?$/);
  if (!match) {
    fail(`Unsupported version format: ${version}. Expected x.y.z or x.y.z-preview.N.`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    preview: match[4] ? Number(match[4]) : null,
  };
}

function bumpStableVersion(parsed, type) {
  if (parsed.preview !== null && type === "patch") {
    return formatVersion({ ...parsed, preview: null });
  }

  return formatVersion({
    ...bumpBaseVersion(parsed, type),
    preview: null,
  });
}

function bumpPreviewVersion(parsed, type) {
  if (parsed.preview !== null && type === "patch") {
    return formatVersion({
      ...parsed,
      preview: parsed.preview + 1,
    });
  }

  return formatVersion({
    ...bumpBaseVersion(parsed, type),
    preview: 1,
  });
}

function bumpBaseVersion(parsed, type) {
  const next = {
    major: parsed.major,
    minor: parsed.minor,
    patch: parsed.patch,
  };

  if (type === "major") {
    next.major += 1;
    next.minor = 0;
    next.patch = 0;
  } else if (type === "minor") {
    next.minor += 1;
    next.patch = 0;
  } else if (parsed.preview === null) {
    next.patch += 1;
  }

  return next;
}

function formatVersion(version) {
  const base = `${version.major}.${version.minor}.${version.patch}`;
  if (version.preview === null) {
    return base;
  }
  return `${base}-preview.${version.preview}`;
}

function writeVersions(version) {
  const packageJson = readJson(trackedFiles.packageJson);
  packageJson.version = version;
  writeJson(trackedFiles.packageJson, packageJson);

  const packageLockJson = readJson(trackedFiles.packageLock);
  packageLockJson.version = version;
  if (packageLockJson.packages?.[""]) {
    packageLockJson.packages[""].version = version;
  }
  writeJson(trackedFiles.packageLock, packageLockJson);

  const tauriConfig = readJson(trackedFiles.tauriConfig);
  tauriConfig.version = version;
  writeJson(trackedFiles.tauriConfig, tauriConfig);

  const cargoToml = fs.readFileSync(trackedFiles.cargoToml, "utf8");
  const nextCargoToml = cargoToml.replace(/^version = ".*"$/m, `version = "${version}"`);
  if (nextCargoToml === cargoToml) {
    fail("Failed to update version in src-tauri/Cargo.toml.");
  }
  fs.writeFileSync(trackedFiles.cargoToml, nextCargoToml, "utf8");

  const cargoLock = fs.readFileSync(trackedFiles.cargoLock, "utf8");
  const nextCargoLock = cargoLock.replace(
    /(\[\[package\]\]\nname = "worktree-desk"\nversion = )".*"/m,
    `$1"${version}"`,
  );
  if (nextCargoLock === cargoLock) {
    fail("Failed to update version in src-tauri/Cargo.lock.");
  }
  fs.writeFileSync(trackedFiles.cargoLock, nextCargoLock, "utf8");
}

function resolvePushTarget(upstream, currentBranch) {
  if (!currentBranch) {
    fail("Could not determine current git branch.");
  }

  if (!upstream) {
    return {
      remoteName: "origin",
      remoteBranch: currentBranch,
    };
  }

  const slashIndex = upstream.indexOf("/");
  if (slashIndex === -1) {
    return {
      remoteName: "origin",
      remoteBranch: currentBranch,
    };
  }

  return {
    remoteName: upstream.slice(0, slashIndex),
    remoteBranch: upstream.slice(slashIndex + 1),
  };
}

function ensureTagDoesNotExist(tagName) {
  const existing = readOptionalStdout(["tag", "--list", tagName]);
  if (existing === tagName) {
    fail(`Git tag already exists: ${tagName}`);
  }
}

function readCargoTomlVersion(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const match = text.match(/^version = "([^"]+)"$/m);
  if (!match) {
    fail(`Could not find version in ${path.relative(repoRoot, filePath)}.`);
  }
  return match[1];
}

function readCargoLockVersion(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const match = text.match(/\[\[package\]\]\nname = "worktree-desk"\nversion = "([^"]+)"/m);
  if (!match) {
    fail(`Could not find worktree-desk version in ${path.relative(repoRoot, filePath)}.`);
  }
  return match[1];
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readStdout(gitArgs) {
  const result = runGit(gitArgs);
  return result.stdout.trim();
}

function readOptionalStdout(gitArgs) {
  const result = spawnSync("git", gitArgs, {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return "";
  }

  return result.stdout.trim();
}

function runGit(gitArgs) {
  const result = spawnSync("git", gitArgs, {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    fail(`git ${gitArgs.join(" ")} failed${details ? `\n${details}` : ""}`);
  }

  return result;
}

function log(message) {
  console.log(`[release] ${message}`);
}

function fail(message) {
  console.error(`[release] ${message}`);
  process.exit(1);
}