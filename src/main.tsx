import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { getVersion } from "@tauri-apps/api/app";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { exit, relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  AlertTriangle,
  Apple,
  Check,
  ChevronDown,
  Code2,
  Eye,
  EyeOff,
  ExternalLink,
  FileCode,
  FileText,
  FolderOpen,
  Gamepad2,
  GitBranch,
  GitCommit,
  Globe,
  Info,
  Lightbulb,
  Loader2,
  Monitor,
  Moon,
  Play,
  Plus,
  RefreshCcw,
  Search,
  Settings,
  Smartphone,
  Sparkles,
  Sun,
  Terminal,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { LocaleProvider, useLocale } from "./i18n";
import "./styles.css";

type WorktreeInfo = {
  path: string;
  head?: string | null;
  branch?: string | null;
  detached: boolean;
  bare: boolean;
  prunable?: string | null;
};

type RepositoryInfo = {
  name: string;
  root: string;
  common_dir: string;
  provider?: ReviewProviderInfo | null;
  gitee?: ReviewProviderInfo | null;
  current_branch?: string | null;
  worktrees: WorktreeInfo[];
};

type ScanResult = {
  root: string;
  repositories: RepositoryInfo[];
};

type BranchInfo = {
  name: string;
  upstream?: string | null;
  remote: boolean;
  current: boolean;
};

type ReviewProviderKind = "gitee" | "github" | "gitlab";

type ReviewProviderCapabilities = {
  approve_review: boolean;
  reset_review: boolean;
  approve_test: boolean;
  reset_test: boolean;
  code_review: boolean;
  cleanup_worktree: boolean;
};

type ReviewProviderInfo = {
  kind: ReviewProviderKind;
  display_name: string;
  remote_name: string;
  host: string;
  owner: string;
  repo: string;
  full_name: string;
  web_url: string;
  clone_url: string;
  capabilities: ReviewProviderCapabilities;
};

type PullRequestInfo = {
  number: number;
  title: string;
  body?: string | null;
  author: string;
  author_avatar?: string | null;
  state?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  web_url: string;
  source_branch?: string | null;
  target_branch?: string | null;
  source_repo?: string | null;
  target_repo?: string | null;
  review_status?: string | null;
  test_status?: string | null;
  review_action_allowed?: boolean | null;
  review_action_blocked_reason?: string | null;
};

type CodeReviewResult = {
  worktree_path: string;
  review_branch: string;
  web_url: string;
};

type PullRequestCacheEntry = {
  items: PullRequestInfo[];
  details: Record<number, PullRequestInfo>;
  selectedNumber: number | null;
};

type ProviderTokenMap = Partial<Record<ReviewProviderKind, string>>;
type RepoProviderTokenMap = Record<string, string>;

type AppView = "workspace" | "reviews";

const editorOptions = [
  { value: "vscode", label: "VS Code", icon: Code2, iconSrc: "/editors/vscode.svg" },
  { value: "cursor", label: "Cursor", icon: Sparkles, iconSrc: "/editors/cursor.svg" },
  { value: "windsurf", label: "Windsurf", icon: Zap, iconSrc: "/editors/windsurf.svg" },
  { value: "zed", label: "Zed", icon: Code2 },
  { value: "sublime", label: "Sublime Text", icon: FileCode, iconSrc: "/editors/sublime.svg" },
  { value: "webstorm", label: "WebStorm", icon: Globe, iconSrc: "/editors/webstorm.svg" },
  { value: "idea", label: "IntelliJ IDEA", icon: Lightbulb, iconSrc: "/editors/idea.svg" },
  { value: "pycharm", label: "PyCharm", icon: Code2, iconSrc: "/editors/pycharm.svg" },
  { value: "goland", label: "GoLand", icon: Play, iconSrc: "/editors/goland.svg" },
  { value: "phpstorm", label: "PhpStorm", icon: FileCode, iconSrc: "/editors/phpstorm.svg" },
  { value: "clion", label: "CLion", icon: Terminal, iconSrc: "/editors/clion.svg" },
  { value: "rider", label: "Rider", icon: Gamepad2, iconSrc: "/editors/rider.svg" },
  { value: "android-studio", label: "Android Studio", icon: Smartphone, iconSrc: "/editors/android-studio.svg" },
  { value: "xcode", label: "Xcode", icon: Apple, iconSrc: "/editors/xcode.svg" },
  { value: "nova", label: "Nova", icon: Code2 },
  { value: "textmate", label: "TextMate", icon: FileText, iconSrc: "/editors/textmate.svg" },
  { value: "emacs", label: "Emacs", icon: Terminal, iconSrc: "/editors/emacs.svg" },
];

const SCAN_RESULT_KEY = "worktree-desk.scanResult";
const EDITOR_MAP_KEY = "worktree-desk.editorMap";
const HIDDEN_REPO_IDS_KEY = "worktree-desk.hiddenRepoIds";
const GITEE_TOKEN_KEY = "worktree-desk.giteeToken";
const PROVIDER_TOKENS_KEY = "worktree-desk.providerTokens";
const REPO_PROVIDER_TOKENS_KEY = "worktree-desk.repoProviderTokens";
const REVIEW_CLEANUP_PREFERENCE_KEY = "worktree-desk.reviewCleanupPreference";
const REVIEW_WINDOW_REPO_KEY = "worktree-desk.reviewWindowRepo";
const MAIN_WINDOW_LABEL = "main";
const REVIEW_WINDOW_LABEL = "reviews";
const REVIEW_WINDOW_DEFAULT_WIDTH = 1365;
const REVIEW_WINDOW_DEFAULT_HEIGHT = 1152;
const REVIEW_WINDOW_MIN_WIDTH = 1240;
const REVIEW_WINDOW_MIN_HEIGHT = 820;
const UPDATE_PROMPTED_VERSION_KEY = "worktree-desk.promptedUpdateVersion";
const UPDATE_MENU_EVENT = "app://check-for-updates";

type ReviewCleanupPreference = "ask" | "delete" | "keep";

type PendingReviewCleanup = {
  number: number;
  title: string;
};

type PendingUpdate = {
  version: string;
  currentVersion: string;
  body?: string | null;
  date?: string | null;
  source: "auto" | "manual";
};

function loadEditorMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(EDITOR_MAP_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

function saveEditorMap(map: Record<string, string>) {
  try {
    localStorage.setItem(EDITOR_MAP_KEY, JSON.stringify(map));
  } catch {}
}

function defaultCapabilities(kind: ReviewProviderKind): ReviewProviderCapabilities {
  return {
    approve_review: true,
    reset_review: kind !== "github",
    approve_test: kind === "gitee",
    reset_test: kind === "gitee",
    code_review: true,
    cleanup_worktree: true,
  };
}

function normalizeProvider(provider: any): ReviewProviderInfo | null {
  if (!provider || typeof provider !== "object") return null;

  const kind = provider.kind === "gitee" || provider.kind === "github" || provider.kind === "gitlab"
    ? provider.kind
    : provider.web_url?.includes("github.com")
      ? "github"
      : provider.web_url?.includes("gitlab")
        ? "gitlab"
        : "gitee";
  const owner = typeof provider.owner === "string" ? provider.owner : "";
  const repo = typeof provider.repo === "string" ? provider.repo : "";
  const fullName = typeof provider.full_name === "string" && provider.full_name
    ? provider.full_name
    : owner && repo
      ? `${owner}/${repo}`
      : repo;
  const host = typeof provider.host === "string" && provider.host
    ? provider.host
    : kind === "github"
      ? "github.com"
      : kind === "gitlab"
        ? "gitlab.com"
        : "gitee.com";
  const displayName = typeof provider.display_name === "string" && provider.display_name
    ? provider.display_name
    : kind === "github"
      ? "GitHub"
      : kind === "gitlab"
        ? "GitLab"
        : "Gitee";

  return {
    kind,
    display_name: displayName,
    remote_name: typeof provider.remote_name === "string" ? provider.remote_name : "origin",
    host,
    owner,
    repo,
    full_name: fullName,
    web_url: typeof provider.web_url === "string" ? provider.web_url : `https://${host}/${fullName}`,
    clone_url: typeof provider.clone_url === "string" ? provider.clone_url : `https://${host}/${fullName}.git`,
    capabilities: provider.capabilities && typeof provider.capabilities === "object"
      ? {
          approve_review: Boolean(provider.capabilities.approve_review),
          reset_review: Boolean(provider.capabilities.reset_review),
          approve_test: Boolean(provider.capabilities.approve_test),
          reset_test: Boolean(provider.capabilities.reset_test),
          code_review: Boolean(provider.capabilities.code_review ?? true),
          cleanup_worktree: Boolean(provider.capabilities.cleanup_worktree ?? true),
        }
      : defaultCapabilities(kind),
  };
}

function normalizeRepositoryInfo(repo: any): RepositoryInfo {
  const provider = normalizeProvider(repo?.provider ?? repo?.gitee);
  return {
    ...repo,
    provider,
    gitee: provider?.kind === "gitee" ? provider : null,
  };
}

function loadCachedResult(): ScanResult | null {
  try {
    const raw = localStorage.getItem(SCAN_RESULT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...parsed,
        repositories: Array.isArray(parsed?.repositories)
          ? parsed.repositories.map(normalizeRepositoryInfo)
          : [],
      };
    }
  } catch {}
  return null;
}

function saveCachedResult(result: ScanResult) {
  try {
    localStorage.setItem(SCAN_RESULT_KEY, JSON.stringify(result));
  } catch {}
}

function loadHiddenRepoIds(): string[] {
  try {
    const raw = localStorage.getItem(HIDDEN_REPO_IDS_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function saveHiddenRepoIds(repoIds: string[]) {
  try {
    localStorage.setItem(HIDDEN_REPO_IDS_KEY, JSON.stringify(Array.from(new Set(repoIds))));
  } catch {}
}

function loadProviderTokens(): ProviderTokenMap {
  try {
    const raw = localStorage.getItem(PROVIDER_TOKENS_KEY);
    const legacyGiteeToken = localStorage.getItem(GITEE_TOKEN_KEY) || "";
    const parsed = raw ? JSON.parse(raw) : {};
    const next: ProviderTokenMap = {
      gitee: typeof parsed?.gitee === "string" ? parsed.gitee : legacyGiteeToken,
      github: typeof parsed?.github === "string" ? parsed.github : "",
      gitlab: typeof parsed?.gitlab === "string" ? parsed.gitlab : "",
    };

    if (legacyGiteeToken && next.gitee !== legacyGiteeToken) {
      next.gitee = legacyGiteeToken;
    }

    return next;
  } catch {}
    return { gitee: "", github: "", gitlab: "" };
}


function saveProviderTokens(tokens: ProviderTokenMap) {
  try {
    const next = {
      gitee: tokens.gitee?.trim() || "",
      github: tokens.github?.trim() || "",
      gitlab: tokens.gitlab?.trim() || "",
    };
    localStorage.setItem(PROVIDER_TOKENS_KEY, JSON.stringify(next));
    if (next.gitee) {
      localStorage.setItem(GITEE_TOKEN_KEY, next.gitee);
    } else {
      localStorage.removeItem(GITEE_TOKEN_KEY);
    }
  } catch {}
}

function loadRepoProviderTokens(): RepoProviderTokenMap {
  try {
    const raw = localStorage.getItem(REPO_PROVIDER_TOKENS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};

    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

function saveRepoProviderTokens(tokens: RepoProviderTokenMap) {
  try {
    localStorage.setItem(REPO_PROVIDER_TOKENS_KEY, JSON.stringify(tokens));
  } catch {}
}

function getRepoProviderTokenKey(repoCommonDir: string, kind: ReviewProviderKind) {
  return `${repoCommonDir}::${kind}`;
}

function getEffectiveProviderToken(
  repo: RepositoryInfo | null | undefined,
  providerTokens: ProviderTokenMap,
  repoProviderTokens: RepoProviderTokenMap,
) {
  const provider = repo?.provider;
  if (!provider || !repo?.common_dir) return "";

  const repoOverride = repoProviderTokens[getRepoProviderTokenKey(repo.common_dir, provider.kind)]?.trim();
  if (repoOverride) return repoOverride;
  return providerTokens[provider.kind]?.trim() || "";
}

function getRepoProviderTokenOverride(
  repo: RepositoryInfo | null | undefined,
  repoProviderTokens: RepoProviderTokenMap,
) {
  const provider = repo?.provider;
  if (!provider || !repo?.common_dir) return "";
  return repoProviderTokens[getRepoProviderTokenKey(repo.common_dir, provider.kind)] || "";
}

function supportsCapability(
  provider: ReviewProviderInfo | null | undefined,
  capability: keyof ReviewProviderCapabilities,
) {
  return Boolean(provider?.capabilities?.[capability]);
}
function loadReviewWindowRepo() {
  try {
    const fromQuery = new URL(window.location.href).searchParams.get("repo");
    if (fromQuery) return fromQuery;
  } catch {}

  try {
    return localStorage.getItem(REVIEW_WINDOW_REPO_KEY);
  } catch {
    return null;
  }
}

function saveReviewWindowRepo(repoCommonDir: string) {
  try {
    localStorage.setItem(REVIEW_WINDOW_REPO_KEY, repoCommonDir);
  } catch {}
}

function loadReviewCleanupPreference(): ReviewCleanupPreference {
  try {
    const stored = localStorage.getItem(REVIEW_CLEANUP_PREFERENCE_KEY);
    if (stored === "ask" || stored === "delete" || stored === "keep") return stored;
  } catch {}
  return "ask";
}

function saveReviewCleanupPreference(preference: ReviewCleanupPreference) {
  try {
    localStorage.setItem(REVIEW_CLEANUP_PREFERENCE_KEY, preference);
  } catch {}
}

function loadPromptedUpdateVersion() {
  try {
    return localStorage.getItem(UPDATE_PROMPTED_VERSION_KEY) || "";
  } catch {
    return "";
  }
}

function savePromptedUpdateVersion(version: string) {
  try {
    if (version) {
      localStorage.setItem(UPDATE_PROMPTED_VERSION_KEY, version);
    } else {
      localStorage.removeItem(UPDATE_PROMPTED_VERSION_KEY);
    }
  } catch {}
}

function getRepoEditor(repoCommonDir: string | null | undefined, fallback = "vscode"): string {
  if (!repoCommonDir) return fallback;
  return loadEditorMap()[repoCommonDir] ?? fallback;
}

function setRepoEditor(repoCommonDir: string | null | undefined, editor: string) {
  if (!repoCommonDir) return;
  const map = loadEditorMap();
  map[repoCommonDir] = editor;
  saveEditorMap(map);
}

type Theme = "light" | "dark" | "system";

const THEME_KEY = "worktree-desk.theme";

function loadTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {}
  return "system";
}

function applyTheme(theme: Theme) {
  const resolved = theme === "system"
    ? (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;
  document.documentElement.setAttribute("data-theme", resolved);
}

function getAppView(): AppView {
  try {
    return new URL(window.location.href).searchParams.get("view") === "reviews" ? "reviews" : "workspace";
  } catch {
    return "workspace";
  }
}

function formatDate(value: string | null | undefined, locale: "en" | "zh") {
  if (!value) return "-";

  try {
    return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function humanizeStatus(value: string | null | undefined) {
  if (!value) return "";
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function normalizeStatus(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/[\s-]+/g, "_") || "";
}

function canResetReview(value: string | null | undefined) {
  return ["approved", "approve", "pass", "passed"].includes(normalizeStatus(value));
}

function canResetTest(value: string | null | undefined) {
  return ["passed", "pass", "success"].includes(normalizeStatus(value));
}

function usesApprovalLanguage(provider: ReviewProviderInfo | null | undefined) {
  return provider?.kind === "github" || provider?.kind === "gitlab";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

type StatusTone = "default" | "error";

type StatusMessageState =
  | { kind: "key"; key: string; args?: unknown[]; tone?: StatusTone }
  | { kind: "text"; text: string; tone?: StatusTone };

function localizedStatusMessage(key: string, ...args: unknown[]): StatusMessageState {
  return { kind: "key", key, args, tone: "default" };
}

function resolveStatusMessage(
  t: (key: any, ...args: any[]) => string,
  state: StatusMessageState | null | undefined,
) {
  if (!state) return "";
  if (state.kind === "text") return state.text;
  return t(state.key, ...(state.args ?? []));
}

function formatByteSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

function App() {
  const { t, locale, setLocale } = useLocale();
  const appView = getAppView();
  const isReviewWindow = appView === "reviews";
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [scanRoot, setScanRoot] = useState(() => localStorage.getItem("worktree-desk.scanRoot") || "~/Documents");
  const [result, setResult] = useState<ScanResult | null>(loadCachedResult);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(() => isReviewWindow ? loadReviewWindowRepo() : null);
  const [hiddenRepoIds, setHiddenRepoIds] = useState(loadHiddenRepoIds);
  const [showHiddenRepos, setShowHiddenRepos] = useState(false);
  const [editor, setEditor] = useState(() => getRepoEditor(null));
  const [worktreePath, setWorktreePath] = useState("");
  const [branch, setBranch] = useState("");
  const [forceRemove, setForceRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyLabelState, setBusyLabelState] = useState<StatusMessageState | null>(null);
  const [messageState, setMessageState] = useState<StatusMessageState>({ kind: "key", key: "status.ready" });
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<WorktreeInfo | null>(null);
  const [pendingCreateBranch, setPendingCreateBranch] = useState<{ branch: string; path: string } | null>(null);
  const [providerTokens, setProviderTokens] = useState<ProviderTokenMap>(loadProviderTokens);
  const [repoProviderTokens, setRepoProviderTokens] = useState<RepoProviderTokenMap>(loadRepoProviderTokens);
  const [pullRequests, setPullRequests] = useState<PullRequestInfo[]>([]);
  const [pullRequestsLoading, setPullRequestsLoading] = useState(false);
  const [pullRequestDetailLoading, setPullRequestDetailLoading] = useState(false);
  const [selectedPullRequestNumber, setSelectedPullRequestNumber] = useState<number | null>(null);
  const [pullRequestDetail, setPullRequestDetail] = useState<PullRequestInfo | null>(null);
  const [reviewCleanupPreference, setReviewCleanupPreference] = useState<ReviewCleanupPreference>(loadReviewCleanupPreference);
  const [pendingReviewCleanup, setPendingReviewCleanup] = useState<PendingReviewCleanup | null>(null);
  const [rememberReviewCleanupChoice, setRememberReviewCleanupChoice] = useState(false);
  const [branchLoadVersion, setBranchLoadVersion] = useState(0);
  const [pendingUpdate, setPendingUpdate] = useState<PendingUpdate | null>(null);

  const repositories = result?.repositories ?? [];
  const hiddenRepoSet = useMemo(() => new Set(hiddenRepoIds), [hiddenRepoIds]);
  const reviewRepositories = useMemo(
    () => repositories.filter((repo) => Boolean(repo.provider)),
    [repositories],
  );
  const availableRepositories = isReviewWindow ? reviewRepositories : repositories;
  const hiddenRepositories = useMemo(
    () => availableRepositories.filter((repo) => hiddenRepoSet.has(repo.common_dir)),
    [availableRepositories, hiddenRepoSet],
  );
  const unhiddenRepositories = useMemo(
    () => availableRepositories.filter((repo) => !hiddenRepoSet.has(repo.common_dir)),
    [availableRepositories, hiddenRepoSet],
  );
  const visibleRepositories = useMemo(
    () => showHiddenRepos ? [...unhiddenRepositories, ...hiddenRepositories] : unhiddenRepositories,
    [hiddenRepositories, showHiddenRepos, unhiddenRepositories],
  );
  const allDisplayedReposHidden = !showHiddenRepos && visibleRepositories.length === 0 && hiddenRepositories.length > 0;
  const activeRepo = useMemo(() => {
    return visibleRepositories.find((repo) => repo.common_dir === selectedRepo) ?? visibleRepositories[0] ?? null;
  }, [visibleRepositories, selectedRepo]);
  const activePullRequest = useMemo(() => {
    if (pullRequestDetail && pullRequestDetail.number === selectedPullRequestNumber) {
      return pullRequestDetail;
    }
    return pullRequests.find((item) => item.number === selectedPullRequestNumber) ?? null;
  }, [pullRequestDetail, pullRequests, selectedPullRequestNumber]);
  const activeProvider = activeRepo?.provider ?? null;
  const activeProviderToken = getEffectiveProviderToken(activeRepo, providerTokens, repoProviderTokens);
  const activeRepoTokenOverride = getRepoProviderTokenOverride(activeRepo, repoProviderTokens);
  const selectedEditor = editorOptions.find((option) => option.value === editor) ?? editorOptions[0];
  const renderEditorIcon = (size: number) => {
    if (selectedEditor.iconSrc) {
      return <img src={selectedEditor.iconSrc} alt={selectedEditor.label} width={size} height={size} style={{ flexShrink: 0 }} />;
    }
    const Icon = selectedEditor.icon;
    return <Icon size={size} />;
  };
  const busyLabel = resolveStatusMessage(t, busyLabelState);
  const message = resolveStatusMessage(t, messageState);
  const messageTone = messageState.tone ?? "default";
  const skipNextEditorPersistRef = useRef(false);
  const branchCacheRef = useRef<Record<string, BranchInfo[]>>({});
  const pullRequestCacheRef = useRef<Record<string, PullRequestCacheEntry>>({});
  const promptedUpdateVersionRef = useRef(loadPromptedUpdateVersion());
  const updateCheckInFlightRef = useRef(false);
  const pendingManualUpdateCheckRef = useRef(false);
  const currentAppVersionRef = useRef("");
  const pendingUpdaterRef = useRef<Update | null>(null);

  function setLocalizedMessage(key: string, ...args: unknown[]) {
    setMessageState(localizedStatusMessage(key, ...args));
  }

  function setRawMessage(text: string, tone: StatusTone = "error") {
    setMessageState({ kind: "text", text, tone });
  }

  function setLocalizedBusyLabel(key: string, ...args: unknown[]) {
    setBusyLabelState(localizedStatusMessage(key, ...args));
  }

  function rememberPromptedUpdateVersion(version: string) {
    promptedUpdateVersionRef.current = version;
    savePromptedUpdateVersion(version);
  }

  async function showMainWindow() {
    const mainWindow = await WebviewWindow.getByLabel(MAIN_WINDOW_LABEL);
    if (!mainWindow) return;

    await mainWindow.show();
    await mainWindow.setFocus();
  }

  async function hideCurrentWindow() {
    try {
      await WebviewWindow.getCurrent().hide();
    } catch {}
  }

  async function disposePendingUpdater() {
    const current = pendingUpdaterRef.current;
    pendingUpdaterRef.current = null;

    if (!current) return;

    try {
      await current.close();
    } catch {}
  }

  async function dismissPendingUpdate() {
    setPendingUpdate(null);
    await disposePendingUpdater();
  }

  function selectText(event: React.FocusEvent<HTMLInputElement> | React.MouseEvent<HTMLInputElement>) {
    event.currentTarget.select();
  }

  function clearPullRequestView() {
    setPullRequests([]);
    setPullRequestDetail(null);
    setSelectedPullRequestNumber(null);
  }

  function invalidateBranchCache(repoRoot?: string | null) {
    if (!repoRoot) return;

    delete branchCacheRef.current[repoRoot];

    if (activeRepo?.root === repoRoot) {
      setBranchLoadVersion((current) => current + 1);
    }
  }

  function rememberPullRequestItems(repoRoot: string, items: PullRequestInfo[], selectedNumber: number | null) {
    const current = pullRequestCacheRef.current[repoRoot];
    pullRequestCacheRef.current[repoRoot] = {
      items,
      details: current?.details ?? {},
      selectedNumber,
    };
  }

  function rememberPullRequestSelection(repoRoot: string, selectedNumber: number | null) {
    const current = pullRequestCacheRef.current[repoRoot];
    if (!current) return;

    pullRequestCacheRef.current[repoRoot] = {
      ...current,
      selectedNumber,
    };
  }

  function rememberPullRequestDetail(repoRoot: string, detail: PullRequestInfo) {
    const current = pullRequestCacheRef.current[repoRoot];
    pullRequestCacheRef.current[repoRoot] = {
      items: current?.items ?? [],
      details: {
        ...(current?.details ?? {}),
        [detail.number]: detail,
      },
      selectedNumber: detail.number,
    };
  }

  function restorePullRequestCache(repoRoot: string, preferredNumber?: number | null) {
    const current = pullRequestCacheRef.current[repoRoot];
    if (!current) return false;

    const nextNumber = preferredNumber != null && current.items.some((item) => item.number === preferredNumber)
      ? preferredNumber
      : current.selectedNumber != null && current.items.some((item) => item.number === current.selectedNumber)
        ? current.selectedNumber
        : current.items[0]?.number ?? null;

    setPullRequests(current.items);
    setSelectedPullRequestNumber(nextNumber);
    setPullRequestDetail(nextNumber != null ? current.details[nextNumber] ?? null : null);
    rememberPullRequestSelection(repoRoot, nextNumber);
    return true;
  }

  function setRepositoryHidden(repoCommonDir: string, hidden: boolean) {
    setHiddenRepoIds((current) => {
      if (hidden) {
        return current.includes(repoCommonDir) ? current : [...current, repoCommonDir];
      }

      return current.filter((item) => item !== repoCommonDir);
    });
  }

  useEffect(() => {
    skipNextEditorPersistRef.current = true;
    setEditor(getRepoEditor(activeRepo?.common_dir));
  }, [activeRepo?.common_dir]);

  useEffect(() => {
    const repoCommonDir = activeRepo?.common_dir;
    if (!repoCommonDir) return;

    if (skipNextEditorPersistRef.current) {
      skipNextEditorPersistRef.current = false;
      return;
    }

    setRepoEditor(repoCommonDir, editor);
  }, [editor, activeRepo?.common_dir]);

  useEffect(() => {
    localStorage.setItem("worktree-desk.scanRoot", scanRoot);
  }, [scanRoot]);

  useEffect(() => {
    saveHiddenRepoIds(hiddenRepoIds);
  }, [hiddenRepoIds]);

  useEffect(() => {
    saveReviewCleanupPreference(reviewCleanupPreference);
  }, [reviewCleanupPreference]);

  useEffect(() => {
    if (!selectedRepo) {
      if (visibleRepositories[0]?.common_dir) {
        setSelectedRepo(visibleRepositories[0].common_dir);
      }
      return;
    }

    if (visibleRepositories.some((repo) => repo.common_dir === selectedRepo)) {
      return;
    }

    if (visibleRepositories[0]?.common_dir) {
      setSelectedRepo(visibleRepositories[0].common_dir);
    }
  }, [selectedRepo, visibleRepositories]);

  useEffect(() => {
    saveProviderTokens(providerTokens);
  }, [providerTokens]);

  useEffect(() => {
    saveRepoProviderTokens(repoProviderTokens);
  }, [repoProviderTokens]);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => {
      if (theme === "system") applyTheme("system");
    };
    mq.addEventListener("change", onSystemChange);
    return () => mq.removeEventListener("change", onSystemChange);
  }, [theme]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === SCAN_RESULT_KEY) {
        setResult(loadCachedResult());
      }

      if (event.key === GITEE_TOKEN_KEY || event.key === PROVIDER_TOKENS_KEY) {
        setProviderTokens(loadProviderTokens());
      }

      if (event.key === REPO_PROVIDER_TOKENS_KEY) {
        setRepoProviderTokens(loadRepoProviderTokens());
      }

      if (event.key === HIDDEN_REPO_IDS_KEY) {
        setHiddenRepoIds(loadHiddenRepoIds());
      }

      if (isReviewWindow && event.key === REVIEW_WINDOW_REPO_KEY) {
        setSelectedRepo(loadReviewWindowRepo());
      }

      if (event.key === UPDATE_PROMPTED_VERSION_KEY) {
        promptedUpdateVersionRef.current = loadPromptedUpdateVersion();
      }
    };

    const onFocus = () => {
      setResult(loadCachedResult());
      setProviderTokens(loadProviderTokens());
      setRepoProviderTokens(loadRepoProviderTokens());
      setHiddenRepoIds(loadHiddenRepoIds());
      promptedUpdateVersionRef.current = loadPromptedUpdateVersion();
      if (isReviewWindow) {
        setSelectedRepo(loadReviewWindowRepo());
      }
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, [isReviewWindow]);

  useEffect(() => {
    if (isReviewWindow && activeRepo?.common_dir) {
      saveReviewWindowRepo(activeRepo.common_dir);
    }
  }, [isReviewWindow, activeRepo?.common_dir]);

  useEffect(() => {
    let cancelled = false;

    void getVersion().then((version) => {
      if (!cancelled) {
        currentAppVersionRef.current = version;
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isReviewWindow) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listen<boolean>(UPDATE_MENU_EVENT, () => {
      if (!disposed) {
        void checkForUpdates("manual");
      }
    }).then((cleanup) => {
      if (disposed) {
        cleanup();
        return;
      }

      unlisten = cleanup;
    });

    void checkForUpdates("auto");

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [isReviewWindow]);

  useEffect(() => {
    const currentWindow = WebviewWindow.getCurrent();
    let disposed = false;
    let unlisten: (() => void) | undefined;

    if (isReviewWindow) {
      void currentWindow.onCloseRequested(async (event) => {
        event.preventDefault();

        try {
          await showMainWindow();
        } catch {}

        try {
          await currentWindow.hide();
        } catch {}
      }).then((cleanup) => {
        if (disposed) {
          cleanup();
          return;
        }

        unlisten = cleanup;
      });

      return () => {
        disposed = true;
        unlisten?.();
      };
    }

    void currentWindow.onCloseRequested(async (event) => {
      event.preventDefault();

      try {
        await exit(0);
      } catch {}
    }).then((cleanup) => {
      if (disposed) {
        cleanup();
        return;
      }

      unlisten = cleanup;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [isReviewWindow]);

  useEffect(() => {
    return () => {
      void disposePendingUpdater();
    };
  }, []);

  useEffect(() => {
    if (!activeRepo) {
      setBranches([]);
      setBranchesLoading(false);
      return;
    }

    const cachedBranches = branchCacheRef.current[activeRepo.root];
    if (cachedBranches) {
      setBranches(cachedBranches);
      setBranchesLoading(false);
      return;
    }

    let cancelled = false;
    setBranchesLoading(true);
    invoke<BranchInfo[]>("list_branches", { repoPath: activeRepo.root })
      .then((items) => {
        if (!cancelled) {
          branchCacheRef.current[activeRepo.root] = items;
          setBranches(items);
        }
      })
      .catch(() => {
        if (!cancelled) setBranches([]);
      })
      .finally(() => {
        if (!cancelled) setBranchesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeRepo?.root, branchLoadVersion]);

  useEffect(() => {
    if (!activeProvider) {
      clearPullRequestView();
      return;
    }

    if (!activeProviderToken.trim()) {
      clearPullRequestView();
      return;
    }

    const restored = restorePullRequestCache(activeRepo.root);
    const cachedPullRequests = pullRequestCacheRef.current[activeRepo.root];
    if (!isReviewWindow) {
      if (!restored) clearPullRequestView();
      return;
    }

    if (!restored || (cachedPullRequests?.items.length ?? 0) === 0) {
      void loadPullRequests(null, { force: true });
    }
  }, [activeRepo?.root, activeProvider?.kind, activeProvider?.full_name, activeProviderToken, isReviewWindow]);

  async function runAction<T>(
    action: () => Promise<T>,
    success: StatusMessageState,
    working: StatusMessageState = localizedStatusMessage("busy.working"),
  ) {
    setBusy(true);
    setBusyLabelState(working);
    setMessageState(working);
    try {
      const value = await action();
      setMessageState(success);
      return value;
    } catch (error) {
      setRawMessage(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setBusy(false);
      setBusyLabelState(null);
    }
  }

  async function installPendingUpdate() {
    const update = pendingUpdaterRef.current;
    if (!update) return;

    setPendingUpdate(null);
    setBusy(true);

    let downloadedBytes = 0;
    let totalBytes = 0;

    try {
      setBusyLabelState(localizedStatusMessage("update.downloading"));
      setMessageState(localizedStatusMessage("update.downloading"));

      await update.downloadAndInstall((progress: DownloadEvent) => {
        if (progress.event === "Started") {
          downloadedBytes = 0;
          totalBytes = progress.data.contentLength ?? 0;
        } else if (progress.event === "Progress") {
          downloadedBytes += progress.data.chunkLength ?? 0;
        } else if (progress.event === "Finished") {
          setBusyLabelState(localizedStatusMessage("update.installing"));
          setMessageState(localizedStatusMessage("update.installing"));
          return;
        }

        const nextStatus = totalBytes > 0
          ? t("update.downloadingProgress", formatByteSize(Math.min(downloadedBytes, totalBytes)), formatByteSize(totalBytes))
          : t("update.downloading");
        setBusyLabelState({ kind: "text", text: nextStatus });
        setMessageState({ kind: "text", text: nextStatus, tone: "default" });
      });

      pendingUpdaterRef.current = null;
      setBusyLabelState(localizedStatusMessage("update.relaunching"));
      setMessageState(localizedStatusMessage("update.installed"));
      await relaunch();
    } catch (error) {
      setRawMessage(getErrorMessage(error));
      if (pendingUpdaterRef.current === update) {
        pendingUpdaterRef.current = null;
      }
      try {
        await update.close();
      } catch {}
    } finally {
      setBusy(false);
      setBusyLabelState(null);
    }
  }

  async function checkForUpdates(source: "auto" | "manual") {
    if (updateCheckInFlightRef.current) {
      if (source === "manual") {
        pendingManualUpdateCheckRef.current = true;
        setLocalizedMessage("update.checking");
      }
      return;
    }

    updateCheckInFlightRef.current = true;

    try {
      if (source === "manual") {
        setBusy(true);
        setBusyLabelState(localizedStatusMessage("update.checking"));
        setMessageState(localizedStatusMessage("update.checking"));
      }

      const update = await check();
      if (!update) {
        if (source === "manual") {
          setLocalizedMessage("update.upToDate", currentAppVersionRef.current || t("status.ready"));
        }
        return;
      }

      const alreadyPrompted = promptedUpdateVersionRef.current === update.version;
      if (source === "auto" && alreadyPrompted) {
        await update.close();
        return;
      }

      await disposePendingUpdater();
      pendingUpdaterRef.current = update;

      if (source === "manual") {
        setLocalizedMessage("update.available", update.version);
      } else {
        rememberPromptedUpdateVersion(update.version);
        setLocalizedMessage("update.availableSilent", update.version);
      }

      setPendingUpdate({
        version: update.version,
        currentVersion: update.currentVersion,
        body: update.body ?? null,
        date: update.date ?? null,
        source,
      });
    } catch (error) {
      if (source === "manual") {
        setRawMessage(getErrorMessage(error));
      }
    } finally {
      if (source === "manual") {
        setBusy(false);
        setBusyLabelState(null);
      }

      updateCheckInFlightRef.current = false;

      const shouldReplayManualCheck = source === "auto"
        && pendingManualUpdateCheckRef.current
        && !pendingUpdaterRef.current;

      pendingManualUpdateCheckRef.current = false;

      if (shouldReplayManualCheck) {
        void checkForUpdates("manual");
      }
    }
  }

  async function loadPullRequests(
    preferredNumber = selectedPullRequestNumber,
    options?: { force?: boolean },
  ) {
    if (!activeProvider || !activeProviderToken.trim()) return;

    const repoRoot = activeRepo.root;
    if (!options?.force && restorePullRequestCache(repoRoot, preferredNumber)) {
      return;
    }

    setPullRequestsLoading(true);
    try {
      const items = await invoke<PullRequestInfo[]>("list_pull_requests", {
        request: {
          repo_path: activeRepo.root,
          access_token: activeProviderToken.trim(),
        },
      });
      setPullRequests(items);

      const nextNumber = preferredNumber && items.some((item) => item.number === preferredNumber)
        ? preferredNumber
        : items[0]?.number ?? null;

      rememberPullRequestItems(repoRoot, items, nextNumber);
      setSelectedPullRequestNumber(nextNumber);
      if (nextNumber != null) {
        rememberPullRequestSelection(repoRoot, nextNumber);
        await loadPullRequestDetail(nextNumber, { force: options?.force });
      } else {
        setPullRequestDetail(null);
      }
    } catch (error) {
      setPullRequests([]);
      setPullRequestDetail(null);
      setSelectedPullRequestNumber(null);
      setRawMessage(getErrorMessage(error));
    } finally {
      setPullRequestsLoading(false);
    }
  }

  async function loadPullRequestDetail(number: number, options?: { force?: boolean }) {
    if (!activeProvider || !activeProviderToken.trim()) return null;

    const repoRoot = activeRepo.root;
    const cachedDetail = !options?.force ? pullRequestCacheRef.current[repoRoot]?.details[number] : null;
    if (cachedDetail) {
      rememberPullRequestSelection(repoRoot, number);
      setPullRequestDetail(cachedDetail);
      return cachedDetail;
    }

    setPullRequestDetailLoading(true);
    try {
      const detail = await invoke<PullRequestInfo>("get_pull_request_detail", {
        request: {
          repo_path: activeRepo.root,
          access_token: activeProviderToken.trim(),
          number,
        },
      });
      rememberPullRequestDetail(repoRoot, detail);
      setPullRequestDetail(detail);
      return detail;
    } catch (error) {
      setPullRequestDetail(null);
      setRawMessage(getErrorMessage(error));
      return null;
    } finally {
      setPullRequestDetailLoading(false);
    }
  }

  async function selectPullRequest(number: number) {
    setSelectedPullRequestNumber(number);
    if (activeRepo) {
      rememberPullRequestSelection(activeRepo.root, number);
    }
    await loadPullRequestDetail(number);
  }

  async function openExternalUrl(url: string) {
    await runAction(
      () =>
        invoke("open_url", {
          request: {
            url,
            editor: null,
          },
        }),
      localizedStatusMessage("open.opened"),
      localizedStatusMessage("open.openingLink"),
    );
  }

  async function approvePullRequest(kind: "review" | "test", number: number, currentStatus?: string | null) {
    if (!activeProvider || !activeProviderToken.trim()) return;

    const resetting = kind === "review" ? canResetReview(currentStatus) : canResetTest(currentStatus);
    const command = kind === "review"
      ? (resetting ? "reset_pull_request_review" : "approve_pull_request_review")
      : (resetting ? "reset_pull_request_test" : "approve_pull_request_test");
    const success = kind === "review"
      ? localizedStatusMessage(resetting ? "gitee.reviewResetDone" : "gitee.reviewPassed")
      : localizedStatusMessage(resetting ? "gitee.testResetDone" : "gitee.testPassed");
    const working = kind === "review"
      ? localizedStatusMessage(resetting ? "gitee.reviewResetting" : "gitee.reviewPassing")
      : localizedStatusMessage(resetting ? "gitee.testResetting" : "gitee.testPassing");
    const finished = await runAction(
      () =>
        invoke<RepositoryInfo>(command, {
          request: {
            repo_path: activeRepo.root,
            access_token: activeProviderToken.trim(),
            number,
          },
        }),
      success,
      working,
    );

    if (finished) {
      replaceRepo(finished);
      await loadPullRequests(number, { force: true });
    }
  }

  async function cleanupCodeReviewWorktree(number: number) {
    if (!activeProvider || !activeProviderToken.trim()) return false;

    const updated = await runAction(
      () =>
        invoke<RepositoryInfo>("cleanup_code_review_worktree", {
          request: {
            repo_path: activeRepo.root,
            access_token: activeProviderToken.trim(),
            number,
          },
        }),
      localizedStatusMessage("gitee.cleanupDeleted"),
      localizedStatusMessage("gitee.cleanupDeleting"),
    );

    if (updated) {
      replaceRepo(updated);
      await loadPullRequests(number, { force: true });
      return true;
    }

    return false;
  }

  async function completePullRequestReview(pullRequest: PullRequestInfo) {
    if (!activeProvider || !activeProviderToken.trim()) return;
    if (canResetReview(pullRequest.review_status)) return;
    if (pullRequest.review_action_allowed === false) {
      if (pullRequest.review_action_blocked_reason) {
        setRawMessage(pullRequest.review_action_blocked_reason);
      } else {
        setLocalizedMessage("review.approveBlocked");
      }
      return;
    }

    const approvalAction = usesApprovalLanguage(activeProvider);

    const updated = await runAction(
      () =>
        invoke<RepositoryInfo>("approve_pull_request_review", {
          request: {
            repo_path: activeRepo.root,
            access_token: activeProviderToken.trim(),
            number: pullRequest.number,
          },
        }),
      localizedStatusMessage(approvalAction ? "gitee.reviewPassed" : "gitee.reviewCompleteDone"),
      localizedStatusMessage(approvalAction ? "gitee.reviewPassing" : "gitee.reviewCompleteDoing"),
    );

    if (!updated) return;

    replaceRepo(updated);
    await loadPullRequests(pullRequest.number, { force: true });

    if (reviewCleanupPreference === "delete") {
      await cleanupCodeReviewWorktree(pullRequest.number);
      return;
    }

    if (reviewCleanupPreference === "ask") {
      setRememberReviewCleanupChoice(false);
      setPendingReviewCleanup({
        number: pullRequest.number,
        title: pullRequest.title,
      });
    }
  }

  async function handleReviewCleanupDecision(shouldDelete: boolean) {
    if (!pendingReviewCleanup) return;

    const pending = pendingReviewCleanup;
    const rememberChoice = rememberReviewCleanupChoice;

    setPendingReviewCleanup(null);
    setRememberReviewCleanupChoice(false);

    if (rememberChoice) {
      setReviewCleanupPreference(shouldDelete ? "delete" : "keep");
    }

    if (shouldDelete) {
      await cleanupCodeReviewWorktree(pending.number);
    }
  }

  async function startCodeReview(pullRequest: PullRequestInfo) {
    if (!activeProvider || !activeProviderToken.trim()) return;

    const prepared = await runAction(
      async () => {
        const review = await invoke<CodeReviewResult>("prepare_code_review", {
          request: {
            repo_path: activeRepo.root,
            access_token: activeProviderToken.trim(),
            number: pullRequest.number,
          },
        });

        await invoke("open_path", {
          request: {
            path: review.worktree_path,
            editor,
            custom_command: null,
          },
        });

        return review;
      },
      localizedStatusMessage("gitee.codeReviewReady"),
      localizedStatusMessage("gitee.codeReviewPreparing"),
    );
  }

  async function openReviewWindow() {
    if (!activeProvider) return;

    saveReviewWindowRepo(activeRepo.common_dir);

    const existing = await WebviewWindow.getByLabel(REVIEW_WINDOW_LABEL);
    if (existing) {
      await existing.show();
      await existing.setFocus();
      await hideCurrentWindow();
      return;
    }

    const url = new URL(window.location.href);
    url.searchParams.set("view", "reviews");
    url.searchParams.set("repo", activeRepo.common_dir);

    const reviewWindow = new WebviewWindow(REVIEW_WINDOW_LABEL, {
      url: url.toString(),
      title: `${t("review.windowTitle")} · ${activeRepoName}`,
      width: REVIEW_WINDOW_DEFAULT_WIDTH,
      height: REVIEW_WINDOW_DEFAULT_HEIGHT,
      minWidth: REVIEW_WINDOW_MIN_WIDTH,
      minHeight: REVIEW_WINDOW_MIN_HEIGHT,
      resizable: true,
    });

    const reviewWindowReady = new Promise<boolean>((resolve) => {
      let settled = false;

      const settle = (value: boolean) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      reviewWindow.once("tauri://created", () => {
        settle(true);
      });

      reviewWindow.once("tauri://error", (event) => {
        void showMainWindow();

        if (typeof event.payload === "string") {
          setRawMessage(event.payload);
        } else {
          setLocalizedMessage("review.unavailable", activeProvider?.display_name || "Git provider");
        }

        settle(false);
      });
    });

    if (await reviewWindowReady) {
      try {
        await reviewWindow.setFocus();
      } catch {}

      await hideCurrentWindow();
    }
  }

  async function scan(root = scanRoot) {
    const value = await runAction(
      () => invoke<ScanResult>("scan_directory", { root }),
      localizedStatusMessage("scan.complete"),
      localizedStatusMessage("scan.scanning"),
    );
    if (value) {
      setResult(value);
      const nextRepositories = isReviewWindow ? value.repositories.filter((repo) => Boolean(repo.provider)) : value.repositories;
      const nextVisibleRepositories = nextRepositories.filter((repo) => !hiddenRepoSet.has(repo.common_dir));
      const nextSelection = showHiddenRepos
        ? nextVisibleRepositories[0]?.common_dir ?? nextRepositories[0]?.common_dir ?? null
        : nextVisibleRepositories[0]?.common_dir ?? nextRepositories[0]?.common_dir ?? null;
      setSelectedRepo(nextSelection);
      saveCachedResult(value);
    }
  }

  async function refreshRepo(repoPath = activeRepo?.root) {
    if (!repoPath) return;

    const updated = await runAction(
      () => invoke<RepositoryInfo>("refresh_repository", { repoPath }),
      localizedStatusMessage("refresh.complete"),
      localizedStatusMessage("refresh.refreshing"),
    );

    if (updated) {
      invalidateBranchCache(updated.root);
      replaceRepo(updated);
    }
  }

  async function chooseDirectory(
    setPath: (path: string) => void,
    defaultPath?: string,
    onSelected?: (path: string) => void | Promise<void>,
  ) {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath,
    });

    if (typeof selected === "string") {
      setPath(selected);
      await onSelected?.(selected);
    }
  }

  function changeBranch(nextBranch: string) {
    setBranch(nextBranch);
    if (activeRepo && nextBranch.trim()) {
      setWorktreePath(defaultWorktreePath(activeRepo.root, nextBranch));
    }
  }

  async function addWorktree() {
    if (!activeRepo || !branch.trim() || !worktreePath.trim()) return;
    const requestedBranch = branch.trim();
    if (!branchExists(branches, requestedBranch)) {
      setPendingCreateBranch({ branch: requestedBranch, path: worktreePath });
      return;
    }

    await submitWorktree(requestedBranch, worktreePath, false);
  }

  async function submitWorktree(branchName: string, path: string, createBranch: boolean) {
    if (!activeRepo) return;
    const updated = await runAction(
      () =>
        invoke<RepositoryInfo>("add_worktree", {
          request: {
            repo_path: activeRepo.root,
            worktree_path: path,
            branch: branchName,
            create_branch: createBranch,
          },
        }),
      localizedStatusMessage("worktree.added"),
      localizedStatusMessage(createBranch ? "worktree.creating" : "worktree.adding"),
    );
    if (updated) {
      invalidateBranchCache(updated.root);
      replaceRepo(updated);
      setWorktreePath("");
      setBranch("");
      setPendingCreateBranch(null);
    }
  }

  async function removeWorktree(path: string) {
    if (!activeRepo) return;
    const target = activeRepo.worktrees.find((worktree) => worktree.path === path);

    if (!target) {
      setPendingRemove(null);
      return;
    }

    if (!canRemoveWorktree(target)) {
      setPendingRemove(null);
      if (!activeRepo) {
        setLocalizedMessage("card.removeTitle");
      } else if (activeRepo.worktrees.length <= 1) {
        setLocalizedMessage("worktree.removeLastBlocked");
      } else if (isMainWorktree(target)) {
        setLocalizedMessage("worktree.removeMainBlocked");
      } else {
        setLocalizedMessage("card.removeTitle");
      }
      return;
    }

    const updated = await runAction(
      () =>
        invoke<RepositoryInfo>("remove_worktree", {
          request: {
            repo_path: activeRepo.root,
            worktree_path: path,
            force: forceRemove,
          },
        }),
      localizedStatusMessage("worktree.removed"),
      localizedStatusMessage("worktree.removing"),
    );
    if (updated) {
      invalidateBranchCache(updated.root);
      replaceRepo(updated);
    }
    setPendingRemove(null);
  }

  async function prune() {
    if (!activeRepo) return;
    const updated = await runAction(
      () => invoke<RepositoryInfo>("prune_worktrees", { repoPath: activeRepo.root }),
      localizedStatusMessage("prune.complete"),
      localizedStatusMessage("prune.pruning"),
    );
    if (updated) {
      invalidateBranchCache(updated.root);
      replaceRepo(updated);
    }
  }

  async function openWorktree(path: string) {
    await runAction(
      () =>
        invoke("open_path", {
          request: {
            path,
            editor,
            custom_command: null,
          },
        }),
      localizedStatusMessage("open.opened"),
      localizedStatusMessage("open.opening"),
    );
  }

  async function openInFileManager(path: string) {
    await runAction(
      () =>
        invoke("open_path", {
          request: {
            path,
            editor: "file-manager",
            custom_command: null,
          },
        }),
      localizedStatusMessage("open.opened"),
      localizedStatusMessage("open.opening"),
    );
  }

  async function copyWorktreePath(path: string) {
    const copied = await runAction(
      async () => {
        await navigator.clipboard.writeText(path);
      },
      localizedStatusMessage("card.copyPathDone"),
      localizedStatusMessage("card.copyPathDoing"),
    );

    return copied !== null;
  }

  function replaceRepo(updated: RepositoryInfo) {
    setResult((previous) => {
      if (!previous) return previous;
      const normalized = normalizeRepositoryInfo(updated);
      const next = {
        ...previous,
        repositories: previous.repositories.map((repo) =>
          repo.common_dir === normalized.common_dir ? normalized : repo,
        ),
      };
      saveCachedResult(next);
      return next;
    });
    setSelectedRepo(updated.common_dir);
  }

  function updateActiveProviderGlobalToken(token: string) {
    if (!activeProvider) return;
    setProviderTokens((current) => ({
      ...current,
      [activeProvider.kind]: token,
    }));
  }

  function updateActiveRepoTokenOverride(token: string) {
    if (!activeProvider || !activeRepo?.common_dir) return;
    const tokenKey = getRepoProviderTokenKey(activeRepo.common_dir, activeProvider.kind);
    setRepoProviderTokens((current) => {
      if (!token.trim()) {
        const next = { ...current };
        delete next[tokenKey];
        return next;
      }

      return {
        ...current,
        [tokenKey]: token,
      };
    });
  }

  const activeRepoName = activeRepo ? activeRepo.name || basename(activeRepo.root) : t("toolbar.noRepo");
  const prunableCount = activeRepo?.worktrees.filter((worktree) => Boolean(worktree.prunable)).length ?? 0;
  function isMainWorktree(worktree: WorktreeInfo) {
    return Boolean(activeRepo) && worktree.path === activeRepo.root;
  }

  function canRemoveWorktree(worktree: WorktreeInfo) {
    return Boolean(activeRepo) && activeRepo.worktrees.length > 1 && !isMainWorktree(worktree);
  }

  function getRemoveWorktreeDisabledReason(worktree: WorktreeInfo) {
    if (!activeRepo) {
      return t("card.removeTitle");
    }

    if (activeRepo.worktrees.length <= 1) {
      return t("worktree.removeLastBlocked");
    }

    if (isMainWorktree(worktree)) {
      return t("worktree.removeMainBlocked");
    }

    return t("card.removeTitle");
  }

  const hasCachedPullRequests = activeRepo ? Boolean(pullRequestCacheRef.current[activeRepo.root]) : false;
  const reviewQueueCount = activeProvider
    ? (activeProviderToken.trim() ? (hasCachedPullRequests ? String(pullRequests.length) : "--") : "--")
    : "0";
  const cleanupPreferenceLabel = reviewCleanupPreference === "delete"
    ? t("settings.cleanupDelete")
    : reviewCleanupPreference === "keep"
      ? t("settings.cleanupKeep")
      : t("settings.cleanupAsk");
  const themeOptions: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
    { value: "light", label: t("theme.light"), icon: Sun },
    { value: "dark", label: t("theme.dark"), icon: Moon },
    { value: "system", label: t("theme.system"), icon: Monitor },
  ];
  const activeProviderName = activeProvider?.display_name || t("review.providerFallback");
  const reviewRepoSummary = activeProvider?.full_name || activeRepo?.root || t("review.noRepo");
  const statusContext = isReviewWindow ? reviewRepoSummary : activeRepoName;
  const statusTask = busyLabel && busyLabel !== message ? busyLabel : "";
  const showReviewStatus = supportsCapability(activeProvider, "approve_review") || pullRequests.some((item) => Boolean(item.review_status));
  const showTestStatus = supportsCapability(activeProvider, "approve_test") || pullRequests.some((item) => Boolean(item.test_status));

  return (
    <main className="desktopShell">
      <div className="desktopBackdrop backdropNorth" />
      <div className={`desktopFrame ${isReviewWindow ? "reviewFrame" : "workspaceFrame"}`}>
        <header className={`titleBar panelSurface ${isReviewWindow ? "reviewTitleBar" : ""}`}>
          <div className="titleBarBrand">
            <div className="brandMark">
              <GitBranch size={22} />
            </div>
            <div>
              <div className="eyebrow">{t("brand.subtitle")}</div>
              <h1>{t("brand.title")}</h1>
            </div>
          </div>

          {isReviewWindow ? (
            <div className="windowSummary">
              <span className="eyebrow">{t("review.windowTitle")}</span>
              <strong>{reviewRepoSummary}</strong>
            </div>
          ) : (
            <label className="field commandField">
              <span>{t("sidebar.scanDir")}</span>
              <div className="commandInputRow">
                <input
                  value={scanRoot}
                  onFocus={selectText}
                  onClick={selectText}
                  onChange={(event) => setScanRoot(event.target.value)}
                />
                <button
                  className="iconButton"
                  onClick={() => void chooseDirectory(setScanRoot, scanRoot, scan)}
                  disabled={busy}
                  title={t("sidebar.chooseDir")}
                >
                  <FolderOpen size={17} />
                </button>
                <button className="iconButton" onClick={() => void scan()} disabled={busy} title={t("sidebar.scan")}>
                  {busy ? <Loader2 className="spin" size={17} /> : <Search size={17} />}
                </button>
              </div>
            </label>
          )}

          <div className="titleBarUtilities">
            <div className={`statusBanner ${busy ? "busy" : ""} ${messageTone === "error" ? "error" : ""}`.trim()} title={message}>
              {busy ? <Loader2 className="spin" size={16} /> : messageTone === "error" ? <X  size={16} color="red" /> : <Check size={16}/>}
              <span className="statusBannerText">{message}</span>
              <button
                type="button"
                className="statusBannerInfo"
                aria-label={t("toolbar.statusInfo")}
                title={t("toolbar.statusInfo")}
              >
                <Info size={14} />
              </button>
              <div className="statusBannerPopover" role="tooltip">
                <span className="eyebrow">{t("toolbar.statusInfo")}</span>
                <div className="statusDetailList">
                  <div className="statusDetailRow">
                    <span>{t("toolbar.statusMessage")}</span>
                    <strong>{message}</strong>
                  </div>
                  <div className="statusDetailRow">
                    <span>{t("toolbar.currentRepo")}</span>
                    <strong>{statusContext}</strong>
                  </div>
                  {statusTask ? (
                    <div className="statusDetailRow">
                      <span>{t("toolbar.statusTask")}</span>
                      <strong>{statusTask}</strong>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="themeButtons compactThemeButtons">
              {themeOptions.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    className={`themeButton compact ${theme === option.value ? "active" : ""}`}
                    onClick={() => setTheme(option.value)}
                    title={option.label}
                  >
                    <Icon size={15} />
                    {option.label}
                  </button>
                );
              })}
            </div>

            <button
              className="secondaryButton utilityButton"
              onClick={() => setLocale(locale === "en" ? "zh" : "en")}
              title={t("lang.switch")}
            >
              {t("lang.switch")}
            </button>
          </div>
        </header>

        <aside className={`sidebar panelSurface ${isReviewWindow ? "reviewSidebar" : "workspaceSidebar"}`}>
          <div className="sidebarSection">
            <div className="sectionBar">
              <span>{t("sidebar.repos")}</span>
              <strong>{visibleRepositories.length}</strong>
            </div>

            {isReviewWindow ? (
              <div className="sidebarPathCard">
                <span>{t("nav.reviews")}</span>
                <strong>{t("review.listTitle")}</strong>
              </div>
            ) : (
              <div className="sidebarPathCard">
                <span>{t("sidebar.scanDir")}</span>
                <strong>{scanRoot}</strong>
              </div>
            )}

            {(hiddenRepositories.length > 0 || showHiddenRepos) && (
              <button
                type="button"
                className={`toggleButton sidebarFilterToggle ${showHiddenRepos ? "active" : ""}`}
                onClick={() => setShowHiddenRepos((current) => !current)}
              >
                {showHiddenRepos ? <EyeOff size={16} /> : <Eye size={16} />}
                {showHiddenRepos ? t("sidebar.hideHidden") : t("sidebar.showHidden", hiddenRepositories.length)}
              </button>
            )}
          </div>

          <div className="sidebarSection sidebarRepoSection">
            {visibleRepositories.length === 0 ? (
              <div className="emptyStrip">{allDisplayedReposHidden ? t("sidebar.allHidden") : isReviewWindow ? t("review.noRepo") : t("sidebar.noRepos")}</div>
            ) : (
              <div className="sidebarRepoList">
                {visibleRepositories.map((repo) => {
                  const repoPrunable = repo.worktrees.filter((worktree) => Boolean(worktree.prunable)).length;
                  const isActive = repo.common_dir === activeRepo?.common_dir;
                  const isHidden = hiddenRepoSet.has(repo.common_dir);
                  const repoLabel = repo.name || basename(repo.root);
                  const repoActionLabel = isHidden ? t("sidebar.showRepo") : t("sidebar.hideRepo");

                  return (
                    <article
                      key={repo.common_dir}
                      className={`sidebarRepoItem ${isActive ? "active" : ""} ${isHidden ? "hidden" : ""}`}
                    >
                      <button
                        type="button"
                        className="sidebarRepoSelect"
                        onClick={() => setSelectedRepo(repo.common_dir)}
                        title={repo.root}
                      >
                        <RepoAvatar repoRoot={repo.root} repoName={repoLabel} />
                        <div className="sidebarRepoMain">
                          <strong className="sidebarRepoTitle">{repoLabel}</strong>
                          <span className="sidebarRepoBranch">{repo.current_branch || t("card.detached")}</span>
                          <div className="sidebarRepoMeta">
                            <em>{t("sidebar.worktrees", repo.worktrees.length)}</em>
                            {repoPrunable > 0 && <em>{t("dashboard.prunable")}: {repoPrunable}</em>}
                            {repo.provider && <span className="miniBadge">{repo.provider.display_name}</span>}
                            {isHidden && <span className="miniBadge hiddenBadge">{t("badge.hidden")}</span>}
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        className="sidebarRepoAction"
                        onClick={() => setRepositoryHidden(repo.common_dir, !isHidden)}
                        title={repoActionLabel}
                        aria-label={`${repoActionLabel}: ${repoLabel}`}
                      >
                        {isHidden ? <Eye size={15} /> : <EyeOff size={15} />}
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        <section className={`mainStage ${isReviewWindow ? "reviewMainStage" : "workspaceMainStage"}`}>
          {activeRepo ? (
            isReviewWindow ? (
              <>
                <section className="workspaceHeader panelSurface reviewWindowHeader">
                  <div className="workspaceHeaderTop">
                    <div className="workspaceIdentity">
                      <div className="eyebrow">{t("nav.reviews")}</div>
                      <h2>{activeRepoName}</h2>
                      <p>{reviewRepoSummary}</p>
                    </div>

                    <div className="workspaceHeaderActions">
                      <div className="headerActionRow">
                        <button className="headerActionButton" onClick={() => void openWorktree(activeRepo.root)} disabled={busy}>
                          {renderEditorIcon(16)}
                          {selectedEditor.label}
                        </button>
                        <button
                          className="headerActionButton"
                          onClick={() => void openExternalUrl(activeProvider?.web_url || activeRepo.root)}
                          disabled={busy || !activeProvider}
                        >
                          <ExternalLink size={16} />
                          {t("review.openRepo")}
                        </button>
                        <button
                          className="headerActionButton emphasis"
                          onClick={() => void loadPullRequests(selectedPullRequestNumber, { force: true })}
                          disabled={busy || pullRequestsLoading || !activeProviderToken.trim()}
                        >
                          {pullRequestsLoading ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
                          {t("review.refreshList")}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="reviewControlBar">
                    <label className="field reviewTokenField">
                      <span>{t("review.globalToken", activeProviderName)}</span>
                      <input
                        type="password"
                        value={activeProvider ? providerTokens[activeProvider.kind] || "" : ""}
                        placeholder={t("review.globalTokenPlaceholder", activeProviderName)}
                        autoComplete="off"
                        onChange={(event) => updateActiveProviderGlobalToken(event.target.value)}
                      />
                    </label>
                    <label className="field reviewTokenField">
                      <span>{t("review.repoToken", activeProviderName)}</span>
                      <input
                        type="password"
                        value={activeRepoTokenOverride}
                        placeholder={t("review.repoTokenPlaceholder", activeProviderName)}
                        autoComplete="off"
                        onChange={(event) => updateActiveRepoTokenOverride(event.target.value)}
                      />
                    </label>
                    <div className="reviewControlHint hint">{t("review.tokenHint", activeProviderName)}</div>
                  </div>

                  <div className="metricStrip">
                    <MetricTile label={t("dashboard.branch")} value={activeRepo.current_branch || t("card.detached")} />
                    <MetricTile label={t("dashboard.worktrees")} value={activeRepo.worktrees.length} />
                    <MetricTile label={t("dashboard.reviewQueue")} value={reviewQueueCount} />
                    <MetricTile label={t("dashboard.prunable")} value={prunableCount} />
                  </div>
                </section>

                <section className="sectionPanel panelSurface reviewWindowPanel">
                  <div className="panelHeaderRow">
                    <div>
                      <h3>{t("review.listTitle")}</h3>
                      <p>{t("review.listHint")}</p>
                    </div>
                  </div>

                  {!activeProvider ? (
                    <div className="empty subtleEmpty">{t("review.unavailable", activeProviderName)}</div>
                  ) : !activeProviderToken.trim() ? (
                    <div className="empty subtleEmpty">{t("review.authRequired", activeProviderName)}</div>
                  ) : pullRequestsLoading ? (
                    <div className="empty subtleEmpty">{t("review.loadingList")}</div>
                  ) : pullRequests.length === 0 ? (
                    <div className="empty subtleEmpty">{t("review.listEmpty")}</div>
                  ) : (
                    <div className="reviewWorkspace">
                      <div className="reviewQueue">
                        {pullRequests.map((item) => {
                          const reviewDone = canResetReview(item.review_status);
                          const testDone = canResetTest(item.test_status);

                          return (
                            <article
                              key={item.number}
                              className={`pullRequestItem ${item.number === selectedPullRequestNumber ? "active" : ""}`}
                            >
                              <button
                                className="pullRequestSelect"
                                onClick={() => void selectPullRequest(item.number)}
                                disabled={busy}
                              >
                                <div className="pullRequestTitleRow">
                                  <strong>#{item.number} {item.title}</strong>
                                  <span className="statusPill emphasis">{humanizeStatus(item.state) || t("gitee.openFallback")}</span>
                                </div>
                                <span>{item.author}</span>
                                <span>
                                  {(item.source_branch || t("gitee.branchUnknown"))}
                                  {" -> "}
                                  {(item.target_branch || t("gitee.branchUnknown"))}
                                </span>
                                <span>{formatDate(item.updated_at || item.created_at, locale)}</span>
                                <div className="pullRequestStatusRow">
                                  {showReviewStatus && (
                                    <span className={`statusPill subtle ${reviewDone ? "success" : ""}`}>
                                      {t("gitee.reviewStatus")}: {humanizeStatus(item.review_status) || t("review.unknown")}
                                    </span>
                                  )}
                                  {showTestStatus && (
                                    <span className={`statusPill subtle ${testDone ? "success" : ""}`}>
                                      {t("gitee.testStatus")}: {humanizeStatus(item.test_status) || t("review.unknown")}
                                    </span>
                                  )}
                                </div>
                              </button>
                            </article>
                          );
                        })}
                      </div>

                      <div className="reviewDetailSurface">
                        {pullRequestDetailLoading ? (
                          <div className="empty subtleEmpty">{t("review.loadingDetail")}</div>
                        ) : activePullRequest ? (
                          <div className="pullRequestDetail">
                            <div className="detailTitleRow detailHeroRow">
                              <div>
                                <h3>#{activePullRequest.number} {activePullRequest.title}</h3>
                                <p>
                                  {(activePullRequest.source_branch || t("gitee.branchUnknown"))}
                                  {" -> "}
                                  {(activePullRequest.target_branch || t("gitee.branchUnknown"))}
                                </p>
                              </div>
                            </div>

                            <div className="detailActionGrid">
                              <button className="reviewActionButton" onClick={() => void openExternalUrl(activePullRequest.web_url)} disabled={busy}>
                                <ExternalLink size={16} />
                                {t("review.openWeb")}
                              </button>
                              {supportsCapability(activeProvider, "code_review") && (
                                <button className="reviewActionButton" onClick={() => void startCodeReview(activePullRequest)} disabled={busy}>
                                  <Code2 size={16} />
                                  {t("gitee.codeReview")}
                                </button>
                              )}
                              {supportsCapability(activeProvider, "approve_review") && (
                                <button
                                  className="reviewActionButton primaryTone"
                                  onClick={() => void completePullRequestReview(activePullRequest)}
                                  disabled={busy || canResetReview(activePullRequest.review_status) || activePullRequest.review_action_allowed === false}
                                  title={activePullRequest.review_action_allowed === false
                                    ? (activePullRequest.review_action_blocked_reason || t("review.approveBlocked"))
                                    : undefined}
                                >
                                  <Check size={16} />
                                  {canResetReview(activePullRequest.review_status)
                                    ? t("gitee.reviewDone")
                                    : usesApprovalLanguage(activeProvider)
                                      ? t("gitee.reviewPass")
                                      : t("gitee.reviewComplete")}
                                </button>
                              )}
                              {supportsCapability(activeProvider, "cleanup_worktree") && (
                                <button
                                  className="reviewActionButton destructiveTone"
                                  onClick={() => void cleanupCodeReviewWorktree(activePullRequest.number)}
                                  disabled={busy}
                                >
                                  <Trash2 size={16} />
                                  {t("gitee.cleanupDelete")}
                                </button>
                              )}
                              {supportsCapability(activeProvider, "approve_test") && !canResetTest(activePullRequest.test_status) && (
                                <button
                                  className="reviewActionButton successTone"
                                  onClick={() => void approvePullRequest("test", activePullRequest.number, activePullRequest.test_status)}
                                  disabled={busy}
                                >
                                  <Check size={16} />
                                  {t("gitee.testPass")}
                                </button>
                              )}
                              {supportsCapability(activeProvider, "reset_review") && canResetReview(activePullRequest.review_status) && (
                                <button
                                  className="reviewActionButton subtleTone"
                                  onClick={() => void approvePullRequest("review", activePullRequest.number, activePullRequest.review_status)}
                                  disabled={busy}
                                >
                                  <RefreshCcw size={16} />
                                  {t("gitee.reviewReset")}
                                </button>
                              )}
                              {supportsCapability(activeProvider, "reset_test") && canResetTest(activePullRequest.test_status) && (
                                <button
                                  className="reviewActionButton subtleTone"
                                  onClick={() => void approvePullRequest("test", activePullRequest.number, activePullRequest.test_status)}
                                  disabled={busy}
                                >
                                  <RefreshCcw size={16} />
                                  {t("gitee.testReset")}
                                </button>
                              )}
                            </div>

                            <div className="detailStatusRow">
                              <span className="statusPill emphasis">
                                {humanizeStatus(activePullRequest.state) || t("gitee.openFallback")}
                              </span>
                              {showReviewStatus && (
                                <span className={`statusPill subtle ${canResetReview(activePullRequest.review_status) ? "success" : ""}`}>
                                  {t("gitee.reviewStatus")}: {humanizeStatus(activePullRequest.review_status) || t("review.unknown")}
                                </span>
                              )}
                              {showTestStatus && (
                                <span className={`statusPill subtle ${canResetTest(activePullRequest.test_status) ? "success" : ""}`}>
                                  {t("gitee.testStatus")}: {humanizeStatus(activePullRequest.test_status) || t("review.unknown")}
                                </span>
                              )}
                            </div>

                            <div className="detailGrid">
                              <div className="detailField">
                                <span>{t("gitee.author")}</span>
                                <strong>{activePullRequest.author || t("gitee.unknown")}</strong>
                              </div>
                              <div className="detailField">
                                <span>{t("gitee.createdAt")}</span>
                                <strong>{formatDate(activePullRequest.created_at, locale)}</strong>
                              </div>
                              <div className="detailField">
                                <span>{t("gitee.updatedAt")}</span>
                                <strong>{formatDate(activePullRequest.updated_at, locale)}</strong>
                              </div>
                              <div className="detailField">
                                <span>{t("gitee.sourceBranch")}</span>
                                <strong>{activePullRequest.source_branch || t("gitee.branchUnknown")}</strong>
                              </div>
                              <div className="detailField">
                                <span>{t("gitee.targetBranch")}</span>
                                <strong>{activePullRequest.target_branch || t("gitee.branchUnknown")}</strong>
                              </div>
                              <div className="detailField">
                                <span>{t("gitee.sourceRepo")}</span>
                                <strong>{activePullRequest.source_repo || t("gitee.unknown")}</strong>
                              </div>
                              <div className="detailField">
                                <span>{t("gitee.targetRepo")}</span>
                                <strong>{activePullRequest.target_repo || t("gitee.unknown")}</strong>
                              </div>
                            </div>

                            <div className="detailBody">
                              <span>{t("gitee.description")}</span>
                              <p>{activePullRequest.body?.trim() || t("gitee.noDescription")}</p>
                            </div>
                          </div>
                        ) : (
                          <div className="empty subtleEmpty">{t("review.selectHint")}</div>
                        )}
                      </div>
                    </div>
                  )}
                </section>
              </>
            ) : (
              <>
                <section className="workspaceHeader panelSurface">
                  <div className="workspaceHeaderTop">
                    <div className="workspaceIdentity">
                      <div className="eyebrow">{t("toolbar.currentRepo")}</div>
                      <h2>{activeRepoName}</h2>
                      <p>{activeRepo.root}</p>
                    </div>

                    <div className="heroBadges">
                      {activeProvider && <span className="heroBadge neutral">{activeProvider.display_name}</span>}
                      <span className="heroBadge">{activeRepo.current_branch || t("card.detached")}</span>
                    </div>
                  </div>

                  <div className="metricStrip">
                    <MetricTile label={t("dashboard.branch")} value={activeRepo.current_branch || t("card.detached")} />
                    <MetricTile label={t("dashboard.worktrees")} value={activeRepo.worktrees.length} />
                    <MetricTile label={t("dashboard.prunable")} value={prunableCount} />
                    <MetricTile label={t("dashboard.reviewQueue")} value={reviewQueueCount} />
                  </div>
                </section>

                <div className="workspaceBody">
                  <section className="workspaceColumn">
                    <section className="sectionPanel panelSurface addWorktreePanel">
                      <div className="panelHeaderRow compactHeader">
                        <div>
                          <h3>{t("panel.addWorktree")}</h3>
                          <p>{t("panel.repoBranch", activeRepo.current_branch || t("card.detached"))}</p>
                        </div>
                      </div>

                      <div className="formGrid compactFormGrid">
                        <label className="field">
                          <span>{t("panel.branch")}</span>
                          <SearchSelect
                            placeholder={branchesLoading ? t("combo.loading") : t("panel.branchPlaceholder")}
                            value={branch}
                            options={branches}
                            onChange={changeBranch}
                          />
                          {branchesLoading && (
                            <div className="inlineLoading" aria-live="polite">
                              <Loader2 className="spin" size={15} />
                              <span>{t("combo.loading")}</span>
                            </div>
                          )}
                        </label>

                        <label className="field">
                          <span>{t("panel.worktreePath")}</span>
                          <div className="pathPicker">
                            <input
                              placeholder={t("panel.pathPlaceholder")}
                              value={worktreePath}
                              onFocus={selectText}
                              onClick={selectText}
                              onChange={(event) => setWorktreePath(event.target.value)}
                            />
                            <button
                              className="iconButton"
                              onClick={() =>
                                void chooseDirectory(
                                  setWorktreePath,
                                  worktreePath || (branch ? defaultWorktreePath(activeRepo.root, branch) : scanRoot),
                                )
                              }
                              disabled={busy}
                              title={t("panel.chooseFolder")}
                            >
                              <FolderOpen size={17} />
                            </button>
                          </div>
                        </label>
                      </div>

                      <div className="panelFooterRow">
                        <div className="hint">{t("panel.hint")}</div>
                        <button className="primary" onClick={() => void addWorktree()} disabled={busy || !branch || !worktreePath}>
                          {busy ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
                          {t("panel.add")}
                        </button>
                      </div>
                    </section>

                    <section className="sectionPanel panelSurface worktreeBoard">
                      <div className="panelHeaderRow">
                        <div>
                          <h3>{t("dashboard.worktreeTitle")}</h3>
                          <p>{t("sidebar.worktrees", activeRepo.worktrees.length)}</p>
                        </div>
                        <label className="forceRemoveCheckbox" title={t("checkbox.force")}>
                          <input
                            type="checkbox"
                            checked={forceRemove}
                            onChange={(e) => setForceRemove(e.target.checked)}
                          />
                          <span>{t("worktree.forceToggle")}</span>
                        </label>
                      </div>

                      <div className="worktreeList">
                        {activeRepo.worktrees.map((worktree) => {
                          const isRootWorktree = isMainWorktree(worktree);
                          const worktreeLabel = worktree.prunable
                            ? t("badge.prunable")
                            : worktree.detached
                              ? t("badge.detached")
                              : t("badge.ready");
                          const canRemove = canRemoveWorktree(worktree);
                          const removeTitle = canRemove ? t("card.removeTitle") : getRemoveWorktreeDisabledReason(worktree);
                          const branchLabel = worktree.branch || t("card.detached");
                          const shortHead = worktree.head?.slice(0, 12) || t("card.unknown");

                          return (
                            <article key={worktree.path} className="worktreeRow">
                              <div className="worktreeSummary">
                                <div className="worktreeRowTop">
                                  <div className="worktreeRowTitle">
                                    <strong>{basename(worktree.path)}</strong>
                                    <span className="worktreePathValue">{worktree.path}</span>
                                  </div>
                                  <div className="worktreeBadgeStack">
                                    {isRootWorktree ? <span className="badge neutral">{t("toolbar.currentRepo")}</span> : null}
                                    <span className={`badge ${worktree.prunable ? "warn" : worktree.detached ? "neutral" : ""}`}>
                                      {worktreeLabel}
                                    </span>
                                  </div>
                                </div>

                                <div className="worktreeMetaRow compactWorktreeMetaRow">
                                  <span className="metaPill">{t("dashboard.branch")}: {branchLabel}</span>
                                  <span className="metaPill">HEAD: {shortHead}</span>
                                  {worktree.bare ? <span className="metaPill">Bare</span> : null}
                                </div>
                              </div>

                              <div className="worktreeRowActions">
                                <button
                                  className="worktreeActionButton primaryAction"
                                  title={t("card.openEditor", selectedEditor.label)}
                                  onClick={() => void openWorktree(worktree.path)}
                                  disabled={busy}
                                >
                                  {renderEditorIcon(16)}
                                  {selectedEditor.label}
                                </button>
                                <button
                                  className="worktreeActionButton"
                                  title={t("card.finderTitle")}
                                  onClick={() => void openInFileManager(worktree.path)}
                                  disabled={busy}
                                >
                                  <FolderOpen size={16} />
                                  {t("card.finder")}
                                </button>
                                <button
                                  className="worktreeActionButton"
                                  onClick={() => void copyWorktreePath(worktree.path)}
                                  disabled={busy}
                                  title={t("card.copyPathTitle")}
                                >
                                  <Code2 size={16} />
                                  {t("card.copyPath")}
                                </button>
                                {canRemove ? (
                                  <button
                                    className="worktreeActionButton danger"
                                    onClick={() => setPendingRemove(worktree)}
                                    disabled={busy}
                                    title={removeTitle}
                                  >
                                    <Trash2 size={16} />
                                    {t("card.remove")}
                                  </button>
                                ) : (
                                  <span className="worktreeActionHint" title={removeTitle}>{removeTitle}</span>
                                )}
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  </section>

                  <aside className="detailColumn">
                    <section className="inspectorCard panelSurface">
                      <div className="panelHeaderRow compactHeader">
                        <div>
                          <h3>{t("panel.repoTools")}</h3>
                          <p>{t("panel.repoBranch", activeRepo.current_branch || t("card.detached"))}</p>
                        </div>
                        <Settings size={18} />
                      </div>

                      <div className="inspectorFields">
                        <label className="field compactField">
                          <span>{t("settings.editor")}</span>
                          <select value={editor} onChange={(event) => setEditor(event.target.value)} title={t("settings.editor")}>
                            {editorOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="field compactField">
                          <span>{t("settings.cleanup")}</span>
                          <select
                            value={reviewCleanupPreference}
                            onChange={(event) => setReviewCleanupPreference(event.target.value as ReviewCleanupPreference)}
                            title={t("settings.cleanup")}
                          >
                            <option value="ask">{t("settings.cleanupAsk")}</option>
                            <option value="delete">{t("settings.cleanupDelete")}</option>
                            <option value="keep">{t("settings.cleanupKeep")}</option>
                          </select>
                        </label>
                      </div>

                      {activeProvider ? (
                        <button onClick={() => void openReviewWindow()} disabled={busy}>
                          <Code2 size={16} />
                          {t("review.windowTitle")}
                        </button>
                      ) : (
                        <div className="empty subtleEmpty">{t("review.unavailable", activeProviderName)}</div>
                      )}
                      <div className="stackedButtons">
                        <button onClick={() => void refreshRepo()} disabled={busy}>
                          {busy ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
                          {t("refresh")}
                        </button>
                        <button onClick={() => void prune()} disabled={busy || prunableCount === 0}>
                          {busy ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
                          {t("prune")}
                        </button>
                      </div>
                    </section>
                  </aside>
                </div>
              </>
            )
          ) : (
            <div className="emptyState panelSurface">
              <GitBranch size={40} />
              <h2>{allDisplayedReposHidden ? t("empty.hiddenReposTitle") : isReviewWindow ? t("review.noRepo") : t("empty.title")}</h2>
              {allDisplayedReposHidden && (
                <>
                  <p>{t("empty.hiddenReposHint")}</p>
                  <button type="button" onClick={() => setShowHiddenRepos(true)}>
                    <Eye size={16} />
                    {t("sidebar.showHidden", hiddenRepositories.length)}
                  </button>
                </>
              )}
            </div>
          )}
        </section>
      </div>

      {busy && (
        <div className="busyOverlay" aria-live="polite">
          <div className="busyBox">
            <Loader2 className="spin" size={24} />
            <span>{busyLabel || t("busy.working")}</span>
          </div>
        </div>
      )}

      {pendingRemove && (
        <div className="modalOverlay" role="presentation">
          <section className="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="remove-title">
            <div className="confirmIcon">
              <AlertTriangle size={22} />
            </div>
            <div>
              <h2 id="remove-title">{t("modal.removeTitle")}</h2>
              <p>{pendingRemove.path}</p>
            </div>
            <div className="confirmActions">
              <button onClick={() => setPendingRemove(null)} disabled={busy}>
                {t("modal.cancel")}
              </button>
              <button className="danger solid" onClick={() => void removeWorktree(pendingRemove.path)} disabled={busy}>
                {busy ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
                {t("modal.remove")}
              </button>
            </div>
          </section>
        </div>
      )}

      {pendingCreateBranch && (
        <div className="modalOverlay" role="presentation">
          <section className="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="create-branch-title">
            <div className="confirmIcon branchIcon">
              <GitBranch size={22} />
            </div>
            <div>
              <h2 id="create-branch-title">{t("modal.createBranchTitle")}</h2>
              <p>{t("modal.createBranchDesc", pendingCreateBranch.branch, pendingCreateBranch.path)}</p>
            </div>
            <div className="confirmActions">
              <button onClick={() => setPendingCreateBranch(null)} disabled={busy}>
                {t("modal.cancel")}
              </button>
              <button
                className="primary"
                onClick={() => void submitWorktree(pendingCreateBranch.branch, pendingCreateBranch.path, true)}
                disabled={busy}
              >
                {busy ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
                {t("modal.create")}
              </button>
            </div>
          </section>
        </div>
      )}

      {pendingReviewCleanup && (
        <div className="modalOverlay" role="presentation">
          <section className="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="cleanup-review-title">
            <div className="confirmIcon branchIcon">
              <Trash2 size={22} />
            </div>
            <div>
              <h2 id="cleanup-review-title">{t("gitee.cleanupTitle")}</h2>
              <p>{t("gitee.cleanupDesc", pendingReviewCleanup.title)}</p>
            </div>
            <div className="confirmActions">
              <button onClick={() => void handleReviewCleanupDecision(false)} disabled={busy}>
                {t("gitee.cleanupKeep")}
              </button>
              <button className="danger solid" onClick={() => void handleReviewCleanupDecision(true)} disabled={busy}>
                {busy ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
                {t("gitee.cleanupDelete")}
              </button>
            </div>
          </section>
        </div>
      )}

      {pendingUpdate && (
        <div className="modalOverlay" role="presentation">
          <section className="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="update-dialog-title">
            <div className="confirmIcon branchIcon">
              <RefreshCcw size={22} />
            </div>
            <div>
              <h2 id="update-dialog-title">{t("update.title")}</h2>
              <p>{t("update.description", pendingUpdate.version, pendingUpdate.currentVersion)}</p>
              {pendingUpdate.body ? <p>{pendingUpdate.body}</p> : null}
            </div>
            <div className="confirmActions">
              <button onClick={() => void dismissPendingUpdate()} disabled={busy}>
                {t("update.later")}
              </button>
              <button className="primary" onClick={() => void installPendingUpdate()} disabled={busy}>
                {busy ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
                {t("update.installNow")}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function MetricTile({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="metricTile">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function RepoAvatar({ repoRoot, repoName }: { repoRoot: string; repoName: string }) {
  const candidateUrls = useMemo(
    () => buildRepoIconCandidates(repoRoot).map((path) => convertFileSrc(path)),
    [repoRoot],
  );
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResolvedSrc(null);

    function loadCandidate(index: number) {
      if (index >= candidateUrls.length || cancelled) return;
      const image = new window.Image();
      const nextUrl = candidateUrls[index];

      image.onload = () => {
        if (!cancelled) {
          setResolvedSrc(nextUrl);
        }
      };

      image.onerror = () => {
        loadCandidate(index + 1);
      };

      image.src = nextUrl;
    }

    loadCandidate(0);

    return () => {
      cancelled = true;
    };
  }, [candidateUrls]);

  if (!resolvedSrc) {
    return (
      <div className="repoAvatarFallback" aria-hidden="true">
        <GitBranch size={16} />
      </div>
    );
  }

  return (
    <img
      className="repoAvatarImage"
      src={resolvedSrc}
      alt={`${repoName} icon`}
    />
  );
}

function SearchSelect({
  value,
  options,
  placeholder,
  onChange,
}: {
  value: string;
  options: BranchInfo[];
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const filtered = useMemo(() => {
    const query = value.trim().toLowerCase();
    const matches = query
      ? options.filter((option) => option.name.toLowerCase().includes(query))
      : options;
    return matches.slice(0, 8);
  }, [options, value]);

  return (
    <div className="combo" onBlur={() => window.setTimeout(() => setOpen(false), 120)}>
      <div className="comboInput">
        <input
          placeholder={placeholder}
          value={value}
          onFocus={(event) => {
            event.currentTarget.select();
            setOpen(true);
          }}
          onClick={(event) => {
            event.currentTarget.select();
            setOpen(true);
          }}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
          }}
        />
        <button
          className="iconButton"
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setOpen((next) => !next)}
          title="Show branches"
        >
          <ChevronDown size={16} />
        </button>
      </div>

      {open && (
        <div className="comboMenu">
          {filtered.length === 0 ? (
            <div className="comboEmpty">{t("combo.noBranches")}</div>
          ) : (
            filtered.map((option) => (
              <button
                className="comboOption"
                key={`${option.remote ? "remote" : "local"}:${option.name}`}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(option.name);
                  setOpen(false);
                }}
              >
                <span>
                  <GitBranch size={14} />
                  {option.name}
                </span>
                {option.current && <Check size={14} />}
                {option.remote && <em>{t("combo.remote")}</em>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function basename(path: string) {
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

function branchExists(branches: BranchInfo[], branchName: string) {
  return branches.some((branch) => branch.name === branchName);
}

function defaultWorktreePath(repoRoot: string, branchName: string) {
  const rootParts = repoRoot.split("/").filter(Boolean);
  const parent = `/${rootParts.slice(0, -1).join("/")}`;
  const branchParts = branchName.trim().replace(/^remotes\//, "").split("/").filter(Boolean);
  const leaf = sanitizePathSegment(branchParts[branchParts.length - 1] || branchName);
  return `${parent}/${leaf}`;
}

function sanitizePathSegment(value: string) {
  return value.replace(/[\\:]/g, "-");
}

function buildRepoIconCandidates(repoRoot: string) {
  return [
    `${repoRoot}/icon.png`,
    `${repoRoot}/icon.jpg`,
    `${repoRoot}/icon.jpeg`,
    `${repoRoot}/.icon`,
  ];
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </React.StrictMode>,
);
