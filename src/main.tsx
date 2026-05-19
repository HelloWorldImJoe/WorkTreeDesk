import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Code2,
  Eye,
  EyeOff,
  ExternalLink,
  FolderOpen,
  GitBranch,
  GitCommit,
  Loader2,
  Monitor,
  Moon,
  Plus,
  RefreshCcw,
  Search,
  Settings,
  Sun,
  Trash2,
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
  gitee?: GiteeRepositoryInfo | null;
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

type GiteeRepositoryInfo = {
  remote_name: string;
  owner: string;
  repo: string;
  web_url: string;
  clone_url: string;
};

type GiteePullRequestInfo = {
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
};

type CodeReviewResult = {
  worktree_path: string;
  review_branch: string;
  web_url: string;
};

type PullRequestCacheEntry = {
  items: GiteePullRequestInfo[];
  details: Record<number, GiteePullRequestInfo>;
  selectedNumber: number | null;
};

type AppView = "workspace" | "reviews";

const editorOptions = [
  { value: "vscode", label: "VS Code", icon: Code2 },
  { value: "cursor", label: "Cursor", icon: Code2 },
  { value: "windsurf", label: "Windsurf", icon: Code2 },
  { value: "zed", label: "Zed", icon: Code2 },
  { value: "sublime", label: "Sublime Text", icon: Code2 },
  { value: "webstorm", label: "WebStorm", icon: Code2 },
  { value: "idea", label: "IntelliJ IDEA", icon: Code2 },
  { value: "pycharm", label: "PyCharm", icon: Code2 },
  { value: "goland", label: "GoLand", icon: Code2 },
  { value: "phpstorm", label: "PhpStorm", icon: Code2 },
  { value: "clion", label: "CLion", icon: Code2 },
  { value: "rider", label: "Rider", icon: Code2 },
  { value: "android-studio", label: "Android Studio", icon: Code2 },
  { value: "xcode", label: "Xcode", icon: Code2 },
  { value: "nova", label: "Nova", icon: Code2 },
  { value: "textmate", label: "TextMate", icon: Code2 },
  { value: "emacs", label: "Emacs", icon: Code2 },
];

const SCAN_RESULT_KEY = "worktree-desk.scanResult";
const EDITOR_MAP_KEY = "worktree-desk.editorMap";
const HIDDEN_REPO_IDS_KEY = "worktree-desk.hiddenRepoIds";
const GITEE_TOKEN_KEY = "worktree-desk.giteeToken";
const REVIEW_CLEANUP_PREFERENCE_KEY = "worktree-desk.reviewCleanupPreference";
const REVIEW_WINDOW_REPO_KEY = "worktree-desk.reviewWindowRepo";
const REVIEW_WINDOW_LABEL = "reviews";
const REVIEW_WINDOW_DEFAULT_WIDTH = 1365;
const REVIEW_WINDOW_DEFAULT_HEIGHT = 1152;
const REVIEW_WINDOW_MIN_WIDTH = 1240;
const REVIEW_WINDOW_MIN_HEIGHT = 820;

type ReviewCleanupPreference = "ask" | "delete" | "keep";

type PendingReviewCleanup = {
  number: number;
  title: string;
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

function loadCachedResult(): ScanResult | null {
  try {
    const raw = localStorage.getItem(SCAN_RESULT_KEY);
    if (raw) return JSON.parse(raw);
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

function loadGiteeToken() {
  try {
    return localStorage.getItem(GITEE_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

function saveGiteeToken(token: string) {
  try {
    if (token.trim()) {
      localStorage.setItem(GITEE_TOKEN_KEY, token.trim());
    } else {
      localStorage.removeItem(GITEE_TOKEN_KEY);
    }
  } catch {}
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

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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
  const [busyLabel, setBusyLabel] = useState("");
  const [message, setMessage] = useState(t("status.ready"));
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<WorktreeInfo | null>(null);
  const [pendingCreateBranch, setPendingCreateBranch] = useState<{ branch: string; path: string } | null>(null);
  const [giteeToken, setGiteeToken] = useState(loadGiteeToken);
  const [pullRequests, setPullRequests] = useState<GiteePullRequestInfo[]>([]);
  const [pullRequestsLoading, setPullRequestsLoading] = useState(false);
  const [pullRequestDetailLoading, setPullRequestDetailLoading] = useState(false);
  const [selectedPullRequestNumber, setSelectedPullRequestNumber] = useState<number | null>(null);
  const [pullRequestDetail, setPullRequestDetail] = useState<GiteePullRequestInfo | null>(null);
  const [reviewCleanupPreference, setReviewCleanupPreference] = useState<ReviewCleanupPreference>(loadReviewCleanupPreference);
  const [pendingReviewCleanup, setPendingReviewCleanup] = useState<PendingReviewCleanup | null>(null);
  const [rememberReviewCleanupChoice, setRememberReviewCleanupChoice] = useState(false);
  const [branchLoadVersion, setBranchLoadVersion] = useState(0);

  const repositories = result?.repositories ?? [];
  const hiddenRepoSet = useMemo(() => new Set(hiddenRepoIds), [hiddenRepoIds]);
  const reviewRepositories = useMemo(
    () => repositories.filter((repo) => Boolean(repo.gitee)),
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
  const selectedEditor = editorOptions.find((option) => option.value === editor) ?? editorOptions[0];
  const SelectedEditorIcon = selectedEditor.icon;
  const skipNextEditorPersistRef = useRef(false);
  const branchCacheRef = useRef<Record<string, BranchInfo[]>>({});
  const pullRequestCacheRef = useRef<Record<string, PullRequestCacheEntry>>({});

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

  function rememberPullRequestItems(repoRoot: string, items: GiteePullRequestInfo[], selectedNumber: number | null) {
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

  function rememberPullRequestDetail(repoRoot: string, detail: GiteePullRequestInfo) {
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
    saveGiteeToken(giteeToken);
  }, [giteeToken]);

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

      if (event.key === GITEE_TOKEN_KEY) {
        setGiteeToken(loadGiteeToken());
      }

      if (event.key === HIDDEN_REPO_IDS_KEY) {
        setHiddenRepoIds(loadHiddenRepoIds());
      }

      if (isReviewWindow && event.key === REVIEW_WINDOW_REPO_KEY) {
        setSelectedRepo(loadReviewWindowRepo());
      }
    };

    const onFocus = () => {
      setResult(loadCachedResult());
      setGiteeToken(loadGiteeToken());
      setHiddenRepoIds(loadHiddenRepoIds());
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
    if (!activeRepo?.gitee) {
      clearPullRequestView();
      return;
    }

    if (!giteeToken.trim()) {
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
  }, [activeRepo?.root, activeRepo?.gitee?.owner, activeRepo?.gitee?.repo, giteeToken, isReviewWindow]);

  async function runAction<T>(action: () => Promise<T>, success: string, working = t("busy.working")) {
    setBusy(true);
    setBusyLabel(working);
    setMessage(working);
    try {
      const value = await action();
      setMessage(success);
      return value;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  }

  async function loadPullRequests(
    preferredNumber = selectedPullRequestNumber,
    options?: { force?: boolean },
  ) {
    if (!activeRepo?.gitee || !giteeToken.trim()) return;

    const repoRoot = activeRepo.root;
    if (!options?.force && restorePullRequestCache(repoRoot, preferredNumber)) {
      return;
    }

    setPullRequestsLoading(true);
    try {
      const items = await invoke<GiteePullRequestInfo[]>("list_gitee_pull_requests", {
        request: {
          repo_path: activeRepo.root,
          access_token: giteeToken.trim(),
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
      setMessage(getErrorMessage(error));
    } finally {
      setPullRequestsLoading(false);
    }
  }

  async function loadPullRequestDetail(number: number, options?: { force?: boolean }) {
    if (!activeRepo?.gitee || !giteeToken.trim()) return null;

    const repoRoot = activeRepo.root;
    const cachedDetail = !options?.force ? pullRequestCacheRef.current[repoRoot]?.details[number] : null;
    if (cachedDetail) {
      rememberPullRequestSelection(repoRoot, number);
      setPullRequestDetail(cachedDetail);
      return cachedDetail;
    }

    setPullRequestDetailLoading(true);
    try {
      const detail = await invoke<GiteePullRequestInfo>("get_gitee_pull_request_detail", {
        request: {
          repo_path: activeRepo.root,
          access_token: giteeToken.trim(),
          number,
        },
      });
      rememberPullRequestDetail(repoRoot, detail);
      setPullRequestDetail(detail);
      return detail;
    } catch (error) {
      setPullRequestDetail(null);
      setMessage(getErrorMessage(error));
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
      t("open.opened"),
      t("open.openingLink"),
    );
  }

  async function approvePullRequest(kind: "review" | "test", number: number, currentStatus?: string | null) {
    if (!activeRepo?.gitee || !giteeToken.trim()) return;

    const resetting = kind === "review" ? canResetReview(currentStatus) : canResetTest(currentStatus);
    const command = kind === "review"
      ? (resetting ? "reset_gitee_pull_request_review" : "approve_gitee_pull_request_review")
      : (resetting ? "reset_gitee_pull_request_test" : "approve_gitee_pull_request_test");
    const success = kind === "review"
      ? (resetting ? t("gitee.reviewResetDone") : t("gitee.reviewPassed"))
      : (resetting ? t("gitee.testResetDone") : t("gitee.testPassed"));
    const working = kind === "review"
      ? (resetting ? t("gitee.reviewResetting") : t("gitee.reviewPassing"))
      : (resetting ? t("gitee.testResetting") : t("gitee.testPassing"));
    const finished = await runAction(
      () =>
        invoke<RepositoryInfo>(command, {
          request: {
            repo_path: activeRepo.root,
            access_token: giteeToken.trim(),
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
    if (!activeRepo?.gitee || !giteeToken.trim()) return false;

    const updated = await runAction(
      () =>
        invoke<RepositoryInfo>("cleanup_gitee_code_review_worktree", {
          request: {
            repo_path: activeRepo.root,
            access_token: giteeToken.trim(),
            number,
          },
        }),
      t("gitee.cleanupDeleted"),
      t("gitee.cleanupDeleting"),
    );

    if (updated) {
      replaceRepo(updated);
      await loadPullRequests(number, { force: true });
      return true;
    }

    return false;
  }

  async function completePullRequestReview(pullRequest: GiteePullRequestInfo) {
    if (!activeRepo?.gitee || !giteeToken.trim()) return;
    if (canResetReview(pullRequest.review_status)) return;

    const updated = await runAction(
      () =>
        invoke<RepositoryInfo>("approve_gitee_pull_request_review", {
          request: {
            repo_path: activeRepo.root,
            access_token: giteeToken.trim(),
            number: pullRequest.number,
          },
        }),
      t("gitee.reviewCompleteDone"),
      t("gitee.reviewCompleteDoing"),
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

  async function startCodeReview(pullRequest: GiteePullRequestInfo) {
    if (!activeRepo?.gitee || !giteeToken.trim()) return;

    const prepared = await runAction(
      async () => {
        const review = await invoke<CodeReviewResult>("prepare_gitee_code_review", {
          request: {
            repo_path: activeRepo.root,
            access_token: giteeToken.trim(),
            number: pullRequest.number,
          },
        });

        await invoke("open_url", {
          request: {
            url: review.web_url,
            editor: "vscode",
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
      t("gitee.codeReviewReady"),
      t("gitee.codeReviewPreparing"),
    );
  }

  async function openReviewWindow() {
    if (!activeRepo?.gitee) return;

    saveReviewWindowRepo(activeRepo.common_dir);

    const existing = await WebviewWindow.getByLabel(REVIEW_WINDOW_LABEL);
    if (existing) {
      await existing.show();
      await existing.setFocus();
      return;
    }

    const url = new URL(window.location.href);
    url.searchParams.set("view", "reviews");
    url.searchParams.set("repo", activeRepo.common_dir);

    const reviewWindow = new WebviewWindow(REVIEW_WINDOW_LABEL, {
      url: url.toString(),
      title: `${t("gitee.openReviewWindow")} · ${activeRepoName}`,
      width: REVIEW_WINDOW_DEFAULT_WIDTH,
      height: REVIEW_WINDOW_DEFAULT_HEIGHT,
      minWidth: REVIEW_WINDOW_MIN_WIDTH,
      minHeight: REVIEW_WINDOW_MIN_HEIGHT,
      resizable: true,
    });

    reviewWindow.once("tauri://error", (event) => {
      setMessage(typeof event.payload === "string" ? event.payload : t("gitee.unavailable"));
    });
  }

  async function scan(root = scanRoot) {
    const value = await runAction(
      () => invoke<ScanResult>("scan_directory", { root }),
      t("scan.complete"),
      t("scan.scanning"),
    );
    if (value) {
      setResult(value);
      const nextRepositories = isReviewWindow ? value.repositories.filter((repo) => Boolean(repo.gitee)) : value.repositories;
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
      t("refresh.complete"),
      t("refresh.refreshing"),
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
      t("worktree.added"),
      createBranch ? t("worktree.creating") : t("worktree.adding"),
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
    const updated = await runAction(
      () =>
        invoke<RepositoryInfo>("remove_worktree", {
          request: {
            repo_path: activeRepo.root,
            worktree_path: path,
            force: forceRemove,
          },
        }),
      t("worktree.removed"),
      t("worktree.removing"),
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
      t("prune.complete"),
      t("prune.pruning"),
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
      t("open.opened"),
      t("open.opening"),
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
      t("open.opened"),
      t("open.opening"),
    );
  }

  function replaceRepo(updated: RepositoryInfo) {
    setResult((previous) => {
      if (!previous) return previous;
      const next = {
        ...previous,
        repositories: previous.repositories.map((repo) =>
          repo.common_dir === updated.common_dir ? updated : repo,
        ),
      };
      saveCachedResult(next);
      return next;
    });
    setSelectedRepo(updated.common_dir);
  }

  const activeRepoName = activeRepo ? activeRepo.name || basename(activeRepo.root) : t("toolbar.noRepo");
  const prunableCount = activeRepo?.worktrees.filter((worktree) => Boolean(worktree.prunable)).length ?? 0;
  const hasCachedPullRequests = activeRepo ? Boolean(pullRequestCacheRef.current[activeRepo.root]) : false;
  const reviewQueueCount = activeRepo?.gitee
    ? (giteeToken.trim() ? (hasCachedPullRequests ? String(pullRequests.length) : "--") : "--")
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
  const reviewRepoSummary = activeRepo?.gitee
    ? `${activeRepo.gitee.owner}/${activeRepo.gitee.repo}`
    : activeRepo?.root ?? t("gitee.noRepo");

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
              <span className="eyebrow">{t("gitee.openReviewWindow")}</span>
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
            <div className={`statusBanner ${busy ? "busy" : ""}`} title={message}>
              {busy ? <Loader2 className="spin" size={16} /> : <Check size={16} />}
              <span>{message}</span>
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
                <strong>{t("gitee.listTitle")}</strong>
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
              <div className="emptyStrip">{allDisplayedReposHidden ? t("sidebar.allHidden") : isReviewWindow ? t("gitee.noRepo") : t("sidebar.noRepos")}</div>
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
                            {repo.gitee && <span className="miniBadge">Gitee</span>}
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
                          <SelectedEditorIcon size={16} />
                          {selectedEditor.label}
                        </button>
                        <button
                          className="headerActionButton"
                          onClick={() => void openExternalUrl(activeRepo.gitee?.web_url || activeRepo.root)}
                          disabled={busy || !activeRepo.gitee}
                        >
                          <ExternalLink size={16} />
                          {t("gitee.openRepo")}
                        </button>
                        <button
                          className="headerActionButton emphasis"
                          onClick={() => void loadPullRequests(selectedPullRequestNumber, { force: true })}
                          disabled={busy || pullRequestsLoading || !giteeToken.trim()}
                        >
                          {pullRequestsLoading ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
                          {t("gitee.refreshList")}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="reviewControlBar">
                    <label className="field reviewTokenField">
                      <span>{t("gitee.apiKey")}</span>
                      <input
                        type="password"
                        value={giteeToken}
                        placeholder={t("gitee.apiKeyPlaceholder")}
                        autoComplete="off"
                        onChange={(event) => setGiteeToken(event.target.value)}
                      />
                    </label>
                    <div className="reviewControlHint hint">{t("gitee.tokenHint")}</div>
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
                      <h3>{t("gitee.listTitle")}</h3>
                      <p>{t("gitee.listHint")}</p>
                    </div>
                  </div>

                  {!activeRepo.gitee ? (
                    <div className="empty subtleEmpty">{t("gitee.unavailable")}</div>
                  ) : !giteeToken.trim() ? (
                    <div className="empty subtleEmpty">{t("empty.reviewAuth")}</div>
                  ) : pullRequestsLoading ? (
                    <div className="empty subtleEmpty">{t("gitee.loadingList")}</div>
                  ) : pullRequests.length === 0 ? (
                    <div className="empty subtleEmpty">{t("gitee.listEmpty")}</div>
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
                                  <span className={`statusPill subtle ${reviewDone ? "success" : ""}`}>
                                    {t("gitee.reviewStatus")}: {humanizeStatus(item.review_status) || t("gitee.unknown")}
                                  </span>
                                  <span className={`statusPill subtle ${testDone ? "success" : ""}`}>
                                    {t("gitee.testStatus")}: {humanizeStatus(item.test_status) || t("gitee.unknown")}
                                  </span>
                                </div>
                              </button>
                            </article>
                          );
                        })}
                      </div>

                      <div className="reviewDetailSurface">
                        {pullRequestDetailLoading ? (
                          <div className="empty subtleEmpty">{t("gitee.loadingDetail")}</div>
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
                                {t("gitee.openWeb")}
                              </button>
                              <button className="reviewActionButton" onClick={() => void startCodeReview(activePullRequest)} disabled={busy}>
                                <Code2 size={16} />
                                {t("gitee.codeReview")}
                              </button>
                              <button
                                className="reviewActionButton primaryTone"
                                onClick={() => void completePullRequestReview(activePullRequest)}
                                disabled={busy || canResetReview(activePullRequest.review_status)}
                              >
                                <Check size={16} />
                                {canResetReview(activePullRequest.review_status) ? t("gitee.reviewDone") : t("gitee.reviewComplete")}
                              </button>
                              <button
                                className="reviewActionButton destructiveTone"
                                onClick={() => void cleanupCodeReviewWorktree(activePullRequest.number)}
                                disabled={busy}
                              >
                                <Trash2 size={16} />
                                {t("gitee.cleanupDelete")}
                              </button>
                              {!canResetTest(activePullRequest.test_status) && (
                                <button
                                  className="reviewActionButton successTone"
                                  onClick={() => void approvePullRequest("test", activePullRequest.number, activePullRequest.test_status)}
                                  disabled={busy}
                                >
                                  <Check size={16} />
                                  {t("gitee.testPass")}
                                </button>
                              )}
                              {canResetReview(activePullRequest.review_status) && (
                                <button
                                  className="reviewActionButton subtleTone"
                                  onClick={() => void approvePullRequest("review", activePullRequest.number, activePullRequest.review_status)}
                                  disabled={busy}
                                >
                                  <RefreshCcw size={16} />
                                  {t("gitee.reviewReset")}
                                </button>
                              )}
                              {canResetTest(activePullRequest.test_status) && (
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
                              <span className={`statusPill subtle ${canResetReview(activePullRequest.review_status) ? "success" : ""}`}>
                                {t("gitee.reviewStatus")}: {humanizeStatus(activePullRequest.review_status) || t("gitee.unknown")}
                              </span>
                              <span className={`statusPill subtle ${canResetTest(activePullRequest.test_status) ? "success" : ""}`}>
                                {t("gitee.testStatus")}: {humanizeStatus(activePullRequest.test_status) || t("gitee.unknown")}
                              </span>
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
                          <div className="empty subtleEmpty">{t("gitee.selectHint")}</div>
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
                      {activeRepo.gitee && <span className="heroBadge neutral">Gitee</span>}
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
                        <button
                          type="button"
                          className={`toggleButton ${forceRemove ? "active" : ""}`}
                          onClick={() => setForceRemove((current) => !current)}
                          title={t("checkbox.force")}
                        >
                          <Trash2 size={16} />
                          {t("worktree.forceToggle")}
                        </button>
                      </div>

                      <div className="worktreeList">
                        {activeRepo.worktrees.map((worktree) => {
                          const worktreeLabel = worktree.prunable
                            ? t("badge.prunable")
                            : worktree.detached
                              ? t("badge.detached")
                              : t("badge.ready");

                          return (
                            <article key={worktree.path} className="worktreeRow">
                              <div className="worktreeSummary">
                                <div className="worktreeRowTop">
                                  <div className="worktreeRowTitle">
                                    <strong>{basename(worktree.path)}</strong>
                                    <span>{worktree.path}</span>
                                  </div>
                                  <span className={`badge ${worktree.prunable ? "warn" : worktree.detached ? "neutral" : ""}`}>
                                    {worktreeLabel}
                                  </span>
                                </div>

                                <div className="worktreeMetaRow">
                                  <span className="metaPill">
                                    <GitBranch size={14} />
                                    {worktree.branch || t("card.detached")}
                                  </span>
                                  <span className="metaPill">
                                    <GitCommit size={14} />
                                    {worktree.head?.slice(0, 12) || t("card.unknown")}
                                  </span>
                                </div>
                              </div>

                              <div className="worktreeRowActions">
                                <button
                                  title={t("card.openEditor", selectedEditor.label)}
                                  onClick={() => void openWorktree(worktree.path)}
                                  disabled={busy}
                                >
                                  <SelectedEditorIcon size={16} />
                                  {selectedEditor.label}
                                </button>
                                <button
                                  title={t("card.finderTitle")}
                                  onClick={() => void openInFileManager(worktree.path)}
                                  disabled={busy}
                                >
                                  <FolderOpen size={16} />
                                  {t("card.finder")}
                                </button>
                                <button
                                  className="danger"
                                  onClick={() => setPendingRemove(worktree)}
                                  disabled={busy}
                                  title={t("card.removeTitle")}
                                >
                                  <Trash2 size={16} />
                                  {t("card.remove")}
                                </button>
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

                      {activeRepo.gitee ? (
                        <button onClick={() => void openReviewWindow()} disabled={busy}>
                          <Code2 size={16} />
                          {t("gitee.openReviewWindow")}
                        </button>
                      ) : (
                        <div className="empty subtleEmpty">{t("gitee.unavailable")}</div>
                      )}
                      <div className="stackedButtons">
                        <button onClick={() => void refreshRepo()} disabled={busy}>
                          {busy ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
                          {t("refresh")}
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
              <h2>{allDisplayedReposHidden ? t("empty.hiddenReposTitle") : isReviewWindow ? t("gitee.noRepo") : t("empty.title")}</h2>
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
