import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  Bell,
  Check,
  ChevronRight,
  CircleDot,
  Code2,
  Copy,
  CopyPlus,
  ExternalLink,
  FileCode2,
  FolderGit2,
  FolderOpen,
  Github,
  GitBranch,
  Gitlab,
  GitMerge,
  GitPullRequest,
  Languages,
  ListTree,
  Loader2,
  MessageSquare,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Search,
  ServerCog,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Send,
  Trash2,
  X,
} from "lucide-react";
import type { CSSProperties, FormEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, UIEvent as ReactUIEvent } from "react";
import { createContext, useContext, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";

type View = "workspaces" | "review" | "settings";
type ProjectMode = "local" | "remote";
type AppLanguage = "zh-CN" | "en-US" | "ja-JP";

type ReviewProviderKind = "gitee" | "github" | "gitlab";
type GitPlatformKey = ReviewProviderKind | "local";
type GitPlatformSelection = GitPlatformKey[];
type ReviewQueueStatus = "open" | "closed" | "merged" | "reverted";
type CodeReviewCleanupPreference = "auto" | "ask" | "keep";

interface ReviewFileViewModel {
  path: string;
  status: "modified" | "added" | "deleted";
  additions: number;
  deletions: number;
  diff: string[];
  patchText?: string;
  patchMissing?: boolean;
  rawUrl?: string | null;
  imagePreview?: PullRequestFilePreview | null;
  binary?: boolean;
}

interface WorktreeStatus {
  dirty: boolean;
  staged: number;
  unstaged: number;
  untracked: number;
  ahead?: number | null;
  behind?: number | null;
  summary: string;
}

interface WorktreeInfo {
  path: string;
  head?: string | null;
  branch?: string | null;
  detached: boolean;
  bare: boolean;
  prunable?: string | null;
  status: WorktreeStatus;
}

interface ReviewProviderInfo {
  kind: ReviewProviderKind;
  display_name: string;
  remote_name: string;
  host: string;
  owner: string;
  repo: string;
  full_name: string;
  web_url: string;
  clone_url: string;
  capabilities: Record<string, boolean>;
}

interface RepositoryInfo {
  name: string;
  root: string;
  common_dir: string;
  provider?: ReviewProviderInfo | null;
  gitee?: ReviewProviderInfo | null;
  current_branch?: string | null;
  worktrees: WorktreeInfo[];
}

interface ScanResult {
  root: string;
  repositories: RepositoryInfo[];
}

interface BranchInfo {
  name: string;
  upstream?: string | null;
  remote: boolean;
  current: boolean;
}

interface Toast {
  tone: "success" | "error" | "info";
  message: string;
}

interface OverflowTooltipState {
  text: string;
  x: number;
  y: number;
}

interface PendingUpdate {
  version: string;
  currentVersion: string;
  body?: string | null;
  date?: string | null;
  source: "auto" | "manual";
  releasePageUrl?: string | null;
  installable: boolean;
}

interface ReleaseCheckResult {
  current_version: string;
  latest_version: string;
  has_update: boolean;
  release_name?: string | null;
  release_notes?: string | null;
  published_at?: string | null;
  release_page_url: string;
}

interface PullRequestViewModel {
  number: number;
  title: string;
  author: string;
  state: "open" | "approved" | "blocked";
  queueStatus: ReviewQueueStatus;
  repositoryName: string;
  repositoryFullName: string;
  repositoryUrl: string;
  providerName: string;
  providerKind: ReviewProviderKind;
  webUrl: string;
  source: string;
  target: string;
  updatedAt: string;
  checks: "passing" | "pending" | "failed";
  files: ReviewFileViewModel[];
}

interface PullRequestInfo {
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
}

interface PullRequestPage {
  state: ReviewQueueStatus;
  page: number;
  per_page: number;
  has_more: boolean;
  items: PullRequestInfo[];
}

interface PullRequestChangedFileInfo {
  filename: string;
  status?: string | null;
  additions?: number | null;
  deletions?: number | null;
  changes?: number | null;
  blob_url?: string | null;
  raw_url?: string | null;
  patch?: string | null;
}

interface PullRequestFilePreview {
  mime_type: string;
  data_url: string;
  size: number;
}

interface PullRequestFileContentInfo {
  filename: string;
  patch?: string | null;
  image_preview?: PullRequestFilePreview | null;
  binary?: boolean | null;
  message?: string | null;
}

interface PullRequestCommentInput {
  filename: string;
  lineIndex: number;
  lineText: string;
  body: string;
}

interface CodeReviewResult {
  worktree_path: string;
  review_branch: string;
  web_url: string;
}

interface ReviewQueueState {
  items: PullRequestViewModel[];
  page: number;
  hasMore: boolean;
  loaded: boolean;
}

interface WorkspaceFilterPreferences {
  searchQuery: string;
  platformSelection: GitPlatformSelection;
}

interface ReviewFilterPreferences extends WorkspaceFilterPreferences {
  queueFilter: ReviewQueueStatus;
}

const SCAN_RESULT_STORAGE_KEY = "worktree-desk.scanResult";
const PINNED_REPOSITORIES_STORAGE_KEY = "workflow-studio.pinnedRepositories";
const WORKSPACE_IDE_STORAGE_KEY = "workflow-studio.workspaceIde";
const REPOSITORY_GITEE_ENTERPRISE_STORAGE_KEY = "workflow-studio.repositoryGiteeEnterprise";
const PROVIDER_TOKENS_STORAGE_KEY = "worktree-desk.providerTokens";
const LANGUAGE_STORAGE_KEY = "workflow-studio.language";
const REVIEW_COMMENTS_STORAGE_KEY = "workflow-studio.reviewComments";
const REVIEW_STATE_OVERRIDES_STORAGE_KEY = "workflow-studio.reviewStateOverrides";
const CODE_REVIEW_CLEANUP_STORAGE_KEY = "workflow-studio.codeReviewCleanup";
const WORKSPACE_FILTERS_STORAGE_KEY = "worktree-desk.workspaceFilters";
const REVIEW_FILTERS_STORAGE_KEY = "worktree-desk.reviewFilters";
const UPDATE_PROMPTED_VERSION_KEY = "worktree-desk.promptedUpdateVersion";
const UPDATE_MENU_EVENT = "app://check-for-updates";
const FAST_TOOLTIP_DELAY_MS = 150;
const FAST_TOOLTIP_OFFSET = 12;
const FAST_TOOLTIP_TITLE_DATA_KEY = "fastTooltipTitle";
const isTauri = "__TAURI_INTERNALS__" in window;
const SIDEBAR_MIN_WIDTH = 184;
const SIDEBAR_MAX_WIDTH = 360;
const SIDEBAR_COLLAPSED_WIDTH = 72;
const REPO_PANEL_MIN_WIDTH = 260;
const REPO_PANEL_MAX_WIDTH = 560;
const REVIEW_LIST_MIN_WIDTH = 300;
const REVIEW_LIST_MAX_WIDTH = 560;
const COMPACT_SPLIT_LAYOUT_QUERY = "(max-width: 860px)";
const PLATFORM_GROUP_ORDER: GitPlatformKey[] = ["github", "gitlab", "gitee", "local"];

const IDE_OPTIONS = [
  { value: "vscode", label: "VS Code", icon: "/editors/vscode.svg" },
  { value: "android-studio", label: "Android Studio", icon: "/editors/android-studio.svg" },
  { value: "xcode", label: "Xcode", icon: "/editors/xcode.svg" },
  { value: "sublime", label: "Sublime Text", icon: "/editors/sublime.svg" },
  { value: "idea", label: "IntelliJ IDEA", icon: "/editors/idea.svg" },
  { value: "pycharm", label: "PyCharm", icon: "/editors/pycharm.svg" },
  { value: "phpstorm", label: "PhpStorm", icon: "/editors/phpstorm.svg" },
  { value: "webstorm", label: "WebStorm", icon: "/editors/webstorm.svg" },
  { value: "goland", label: "GoLand", icon: "/editors/goland.svg" },
  { value: "clion", label: "CLion", icon: "/editors/clion.svg" },
  { value: "cursor", label: "Cursor", icon: "/editors/cursor.svg" },
  { value: "windsurf", label: "Windsurf", icon: "/editors/windsurf.svg" },
  { value: "rider", label: "Rider", icon: "/editors/rider.svg" },
  { value: "textmate", label: "TextMate", icon: "/editors/textmate.svg" },
  { value: "emacs", label: "Emacs", icon: "/editors/emacs.svg" },
];

const HOSTING_PROVIDERS = [
  { kind: "github", name: "GitHub", icon: Github, host: "github.com", tone: "github" },
  { kind: "gitlab", name: "GitLab", icon: Gitlab, host: "gitlab.com / self-hosted", tone: "gitlab" },
  { kind: "gitee", name: "Gitee", icon: ServerCog, host: "gitee.com", tone: "gitee" },
] satisfies Array<{ kind: ReviewProviderKind; name: string; icon: typeof Github; host: string; tone: string }>;

const LANGUAGE_OPTIONS = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en-US", label: "English" },
  { value: "ja-JP", label: "日本語" },
] satisfies Array<{ value: AppLanguage; label: string }>;

const REVIEW_QUEUE_FILTERS = [
  { value: "open", labelKey: "review.filter.open" },
  { value: "closed", labelKey: "review.filter.closed" },
  { value: "merged", labelKey: "review.filter.merged" },
  { value: "reverted", labelKey: "review.filter.reverted" },
] satisfies Array<{ value: ReviewQueueStatus; labelKey: string }>;
const REVIEW_PAGE_SIZE = 20;
const REVIEW_INITIAL_FILE_COUNT = 80;
const REVIEW_FILE_COUNT_STEP = 80;
const REVIEW_INITIAL_DIFF_LINES = 360;
const REVIEW_DIFF_LINE_STEP = 360;

const I18N_MESSAGES: Record<AppLanguage, Record<string, string>> = {
  "zh-CN": {
    "app.eyebrow": "Git Client",
    "app.subtitle": "Git Worktree 与代码评审",
    "app.desktopOnlyUpdate": "桌面应用内才能检查更新",
    "app.developmentPreview": "开发预览",
    "app.unknownVersion": "未知版本",
    "nav.workspaces": "工作区",
    "nav.codeReview": "代码评审",
    "nav.settings": "设置",
    "nav.expandSidebar": "展开侧栏",
    "nav.collapseSidebar": "折叠侧栏",
    "nav.activeRepos": "活动仓库",
    "nav.activeReposTitle": "查看活动仓库",
    "nav.queue": "队列",
    "nav.reviewQueueTitle": "查看代码评审队列",
    "topbar.workspacesTitle": "工作区管理",
    "topbar.reviewTitle": "代码评审",
    "topbar.settingsTitle": "设置",
    "topbar.pickFolder": "选择本地文件夹",
    "topbar.scanPlaceholder": "扫描目录",
    "topbar.scanDirectory": "扫描目录",
    "topbar.newProject": "新建项目",
    "layout.adjustSidebar": "调整侧栏宽度",
    "layout.dragSidebar": "拖拽调整侧栏宽度",
    "filter.all": "全部平台",
    "filter.platform": "Git 平台",
    "repo.searchPlaceholder": "仓库、路径、远端",
    "repo.filter": "筛选",
    "repo.collapseList": "收起仓库列表",
    "repo.expandList": "展开仓库列表",
    "repo.pin": "固定到顶部",
    "repo.unpin": "取消固定",
    "repo.adjustList": "调整仓库列表宽度",
    "repo.dragList": "拖拽调整仓库列表宽度",
    "repo.worktrees": "工作区",
    "repo.dirty": "有变更",
    "repo.provider": "托管平台",
    "repo.giteeEnterprise": "企业版",
    "repo.localRepository": "本地仓库",
    "repo.none": "无",
    "repo.copyPath": "复制仓库路径",
    "repo.selectIde": "选择打开 IDE",
    "repo.open": "打开",
    "repo.openWith": "用 {editor} 打开",
    "repo.openFinder": "在 Finder 中打开",
    "repo.finder": "Finder",
    "repo.newWorktree": "新建工作区",
    "repo.table.path": "路径",
    "repo.table.branch": "分支",
    "repo.table.status": "状态",
    "repo.table.sync": "同步",
    "repo.refresh": "刷新仓库",
    "repo.noRepoTitle": "未加载仓库",
    "repo.noRepoHint": "选择目录后扫描",
    "repo.noMatches": "没有匹配的仓库。",
    "repo.copyWorktreePath": "复制工作区路径",
    "repo.remove": "移除",
    "repo.prunable": "可清理",
    "repo.clean": "干净",
    "repo.detached": "游离 HEAD",
    "repo.bare": "裸仓库",
    "review.queueTitle": "代码评审队列",
    "review.refreshQueue": "刷新代码评审队列",
    "review.searchPlaceholder": "编号、标题、仓库、分支",
    "review.collapseList": "收起评审列表",
    "review.expandList": "展开评审列表",
    "review.adjustList": "调整评审列表宽度",
    "review.dragList": "拖拽调整评审列表宽度",
    "review.noProvider": "当前仓库没有可用的评审远端。",
    "review.tokenRequired": "在设置里关联 {provider} Token 后加载真实队列。",
    "review.emptyGroup": "这个分组暂无 PR/MR。",
    "review.noMatches": "没有匹配的 PR/MR。",
    "review.loading": "正在加载评审...",
    "review.loadMore": "加载更多",
    "review.openRemote": "打开远端",
    "review.mergeCode": "合并代码",
    "review.mergePr": "合并 PR",
    "review.mergeMr": "合并 MR",
    "review.mergeBlocked": "评审通过且检查通过后才能合并",
    "review.waitingMerge": "等待合并",
    "review.changedFiles": "变更文件",
    "review.readonly": "只读",
    "review.noFileChanges": "当前接口没有返回文件变更。",
    "review.loadingFileDiff": "正在加载文件差异...",
    "review.comment": "评论",
    "review.you": "你",
    "review.commentPlaceholder": "添加这行变更的评审评论",
    "review.cancel": "取消",
    "review.noTextDiff": "此文件没有可展示的文本差异。",
    "review.showMoreFiles": "显示更多文件（剩余 {count} 个）",
    "review.showMoreDiff": "显示更多差异（剩余 {count} 行）",
    "review.showUnchangedLines": "展开未变更行",
    "review.hideUnchangedLines": "折叠未变更行",
    "review.unchangedLines": "{count} 行未变更",
    "review.hiddenUnchangedLines": "已折叠 {count} 行未变更内容",
    "review.approve": "通过评审",
    "review.unapprove": "取消通过",
    "review.codeReview": "CodeReview",
    "review.closePr": "关闭 PR",
    "review.reopen": "重新开启",
    "review.noSelectedTitle": "没有选中的 PR/MR",
    "review.noSelectedHint": "选择仓库并关联 Token 后会显示真实评审详情",
    "review.filter.open": "开启的",
    "review.filter.closed": "关闭的",
    "review.filter.merged": "合并的",
    "review.filter.reverted": "回退的",
    "review.terminal.closed": "已关闭",
    "review.terminal.merged": "已合并",
    "review.terminal.reverted": "已回退",
    "review.terminal.open": "开启中",
    "review.state.passing": "检查通过",
    "review.state.pending": "检查中",
    "review.state.failed": "检查失败",
    "review.hint.closed": "此评审已关闭，可重新开启后继续处理",
    "review.hint.merged": "变更已合入，当前仅可查看",
    "review.hint.reverted": "变更已回退，当前仅可查看",
    "review.hint.canMerge": "已达到合并条件",
    "review.hint.waiting": "等待评审达标",
    "settings.subtitle": "托管平台、评审偏好、语言和更新",
    "settings.version": "当前版本",
    "settings.hosting": "托管平台",
    "settings.linkedCount": "{linked}/{total} 已关联",
    "settings.linked": "已关联",
    "settings.preferences": "应用偏好",
    "settings.preferencesHint": "界面、评审和更新",
    "settings.language": "应用语言",
    "settings.cleanup": "结束后清理",
    "settings.checkUpdates": "检查更新",
    "settings.cleanup.auto": "自动删除",
    "settings.cleanup.ask": "每次询问",
    "settings.cleanup.keep": "保留",
    "settings.cleanup.autoDesc": "结束后自动删除临时工作区和临时分支",
    "settings.cleanup.askDesc": "结束后询问是否删除临时工作区和临时分支",
    "settings.cleanup.keepDesc": "结束后保留临时工作区和临时分支",
    "settings.channel.dev": "开发通道",
    "settings.channel.unknown": "未知通道",
    "settings.channel.preview": "Preview 通道",
    "settings.channel.stable": "Stable 通道",
    "modal.close": "关闭",
    "modal.cancel": "取消",
    "modal.save": "保存",
    "modal.providerTitle": "{provider} 关联",
    "modal.token": "Token",
    "modal.tokenPlaceholderNew": "输入访问 Token",
    "modal.tokenPlaceholderUpdate": "输入新 Token 更新关联",
    "modal.updateLink": "更新关联",
    "modal.confirmLink": "确认关联",
    "modal.repository": "仓库",
    "modal.newWorktree": "新建工作区",
    "modal.branch": "分支",
    "modal.path": "路径",
    "modal.createBranch": "创建新分支",
    "modal.create": "创建",
    "modal.newProject": "新建项目",
    "modal.local": "本地",
    "modal.remote": "远程",
    "modal.localRepo": "本地仓库",
    "modal.remoteUrl": "远程地址",
    "modal.targetDir": "目标目录",
    "modal.dirName": "目录名",
    "modal.autoInfer": "自动推断",
    "modal.chooseDirectory": "选择目录",
    "modal.add": "加入",
    "modal.clone": "Clone",
    "modal.cleanupCodeReview": "清理 CodeReview",
    "modal.cleanupQuestion": "是否删除这个评审创建的临时工作区和 review/pr 临时分支？",
    "modal.keep": "保留",
    "modal.deleteTemp": "删除临时资源",
    "modal.updateFound": "发现新版本",
    "modal.detectedVersion": "检测到新版本 {version}",
    "modal.currentVersion": "当前版本为 {version}",
    "modal.noUpdateNotes": "此版本没有附加更新说明。",
    "modal.later": "稍后",
    "modal.installRestart": "立即安装并重启",
    "modal.openReleasePage": "打开发布页",
    "toast.scanned": "已扫描 {count} 个仓库",
    "toast.refreshed": "{name} 已刷新",
    "toast.pinned": "{name} 已固定到顶部",
    "toast.unpinned": "{name} 已取消固定",
    "toast.providerLinked": "{provider} 已关联",
    "toast.languageChanged": "语言已切换为 {language}",
    "toast.cleanupPreference": "CodeReview 清理策略已设为 {preference}",
    "toast.pathCopied": "路径已复制",
    "toast.reviewApproved": "评审已通过",
    "toast.reviewReset": "评审状态已重置",
    "toast.prReopened": "PR/MR 已重新开启",
    "toast.prClosed": "PR/MR 已关闭",
    "toast.prMerged": "PR/MR 已合并",
    "toast.commentSynced": "评论已同步到 Git 平台",
    "toast.cleanupDone": "CodeReview 临时工作区和分支已清理",
    "toast.workspaceCreated": "工作区已创建",
    "toast.projectAdded": "{name} 已加入",
    "toast.workspaceRemoved": "工作区已移除",
    "toast.updateChecking": "正在检查更新...",
    "toast.currentLatest": "当前已经是最新版本（{version}）。",
    "toast.updateFound": "发现新版本 {version}",
    "toast.updateFoundReleasePage": "发现新版本 {version}，可打开发布页查看",
    "toast.updateDetected": "检测到新版本：{version}",
    "update.downloading": "正在下载更新...",
    "update.downloadingProgress": "正在下载更新... {downloaded} / {total}",
    "update.installing": "正在安装更新...",
    "update.restart": "更新已安装，正在重启应用...",
    "error.noRepoToken": "请先选择仓库并关联 Token。",
    "error.directoryUnavailable": "目录选择不可用",
    "error.copyFailed": "复制失败",
    "error.operationFailed": "操作失败",
    "error.updateManifest": "当前通道的更新清单不可用，请稍后再试。",
    "error.noRelease": "没有找到当前通道的发布版本。"
  },
  "en-US": {
    "app.eyebrow": "Git Client",
    "app.subtitle": "Git Worktree & Code Review",
    "app.desktopOnlyUpdate": "Updates can only be checked in the desktop app.",
    "app.developmentPreview": "Development preview",
    "app.unknownVersion": "Unknown version",
    "nav.workspaces": "Workspaces",
    "nav.codeReview": "Code Review",
    "nav.settings": "Settings",
    "nav.expandSidebar": "Expand sidebar",
    "nav.collapseSidebar": "Collapse sidebar",
    "nav.activeRepos": "Active repos",
    "nav.activeReposTitle": "View active repositories",
    "nav.queue": "Queue",
    "nav.reviewQueueTitle": "View code review queue",
    "topbar.workspacesTitle": "Workspace Management",
    "topbar.reviewTitle": "Code Review",
    "topbar.settingsTitle": "Settings",
    "topbar.pickFolder": "Choose local folder",
    "topbar.scanPlaceholder": "Scan directory",
    "topbar.scanDirectory": "Scan directory",
    "topbar.newProject": "New Project",
    "layout.adjustSidebar": "Resize sidebar",
    "layout.dragSidebar": "Drag to resize sidebar",
    "filter.all": "All platforms",
    "filter.platform": "Git platform",
    "repo.searchPlaceholder": "Repository, path, remote",
    "repo.filter": "Filter",
    "repo.collapseList": "Collapse repository list",
    "repo.expandList": "Expand repository list",
    "repo.pin": "Pin to top",
    "repo.unpin": "Unpin",
    "repo.adjustList": "Resize repository list",
    "repo.dragList": "Drag to resize repository list",
    "repo.worktrees": "Worktrees",
    "repo.dirty": "Changed",
    "repo.provider": "Provider",
    "repo.giteeEnterprise": "Enterprise",
    "repo.localRepository": "Local repository",
    "repo.none": "None",
    "repo.copyPath": "Copy repository path",
    "repo.selectIde": "Choose IDE",
    "repo.open": "Open",
    "repo.openWith": "Open with {editor}",
    "repo.openFinder": "Open in Finder",
    "repo.finder": "Finder",
    "repo.newWorktree": "New Worktree",
    "repo.table.path": "Path",
    "repo.table.branch": "Branch",
    "repo.table.status": "Status",
    "repo.table.sync": "Sync",
    "repo.refresh": "Refresh repository",
    "repo.noRepoTitle": "No repository loaded",
    "repo.noRepoHint": "Choose a directory and scan",
    "repo.noMatches": "No repositories match the current filters.",
    "repo.copyWorktreePath": "Copy worktree path",
    "repo.remove": "Remove",
    "repo.prunable": "Prunable",
    "repo.clean": "Clean",
    "repo.detached": "Detached HEAD",
    "repo.bare": "Bare repository",
    "review.queueTitle": "Code Review Queue",
    "review.refreshQueue": "Refresh code review queue",
    "review.searchPlaceholder": "Number, title, repository, branch",
    "review.collapseList": "Collapse review list",
    "review.expandList": "Expand review list",
    "review.adjustList": "Resize review list",
    "review.dragList": "Drag to resize review list",
    "review.noProvider": "This repository has no available review remote.",
    "review.tokenRequired": "Link a {provider} token in Settings to load the live queue.",
    "review.emptyGroup": "No PR/MR in this group.",
    "review.noMatches": "No PR/MR match the current filters.",
    "review.loading": "Loading reviews...",
    "review.loadMore": "Load more",
    "review.openRemote": "Open remote",
    "review.mergeCode": "Merge code",
    "review.mergePr": "Merge PR",
    "review.mergeMr": "Merge MR",
    "review.mergeBlocked": "Approval and passing checks are required before merging",
    "review.waitingMerge": "Waiting to merge",
    "review.changedFiles": "Changed files",
    "review.readonly": "Read only",
    "review.noFileChanges": "The API did not return changed files.",
    "review.loadingFileDiff": "Loading file diff...",
    "review.comment": "Comment",
    "review.you": "You",
    "review.commentPlaceholder": "Add a review comment for this changed line",
    "review.cancel": "Cancel",
    "review.noTextDiff": "No displayable text diff for this file.",
    "review.showMoreFiles": "Show more files ({count} remaining)",
    "review.showMoreDiff": "Show more diff lines ({count} remaining)",
    "review.showUnchangedLines": "Show unchanged lines",
    "review.hideUnchangedLines": "Collapse unchanged lines",
    "review.unchangedLines": "{count} unchanged lines",
    "review.hiddenUnchangedLines": "Collapsed {count} unchanged lines",
    "review.approve": "Approve review",
    "review.unapprove": "Cancel approval",
    "review.codeReview": "CodeReview",
    "review.closePr": "Close PR",
    "review.reopen": "Reopen",
    "review.noSelectedTitle": "No PR/MR selected",
    "review.noSelectedHint": "Select a repository and link a token to show live review details",
    "review.filter.open": "Open",
    "review.filter.closed": "Closed",
    "review.filter.merged": "Merged",
    "review.filter.reverted": "Reverted",
    "review.terminal.closed": "Closed",
    "review.terminal.merged": "Merged",
    "review.terminal.reverted": "Reverted",
    "review.terminal.open": "Open",
    "review.state.passing": "Checks passing",
    "review.state.pending": "Checks pending",
    "review.state.failed": "Checks failed",
    "review.hint.closed": "This review is closed. Reopen it to continue.",
    "review.hint.merged": "The changes have been merged and are read-only.",
    "review.hint.reverted": "The changes have been reverted and are read-only.",
    "review.hint.canMerge": "Ready to merge",
    "review.hint.waiting": "Waiting for review requirements",
    "settings.subtitle": "Hosting, review preferences, language and updates",
    "settings.version": "Current version",
    "settings.hosting": "Hosting",
    "settings.linkedCount": "{linked}/{total} linked",
    "settings.linked": "Linked",
    "settings.preferences": "Preferences",
    "settings.preferencesHint": "Interface, review and updates",
    "settings.language": "App language",
    "settings.cleanup": "After review",
    "settings.checkUpdates": "Check updates",
    "settings.cleanup.auto": "Auto delete",
    "settings.cleanup.ask": "Ask each time",
    "settings.cleanup.keep": "Keep",
    "settings.cleanup.autoDesc": "Delete temporary worktrees and branches after review",
    "settings.cleanup.askDesc": "Ask before deleting temporary worktrees and branches after review",
    "settings.cleanup.keepDesc": "Keep temporary worktrees and branches after review",
    "settings.channel.dev": "Development channel",
    "settings.channel.unknown": "Unknown channel",
    "settings.channel.preview": "Preview channel",
    "settings.channel.stable": "Stable channel",
    "modal.close": "Close",
    "modal.cancel": "Cancel",
    "modal.save": "Save",
    "modal.providerTitle": "Link {provider}",
    "modal.token": "Token",
    "modal.tokenPlaceholderNew": "Enter access token",
    "modal.tokenPlaceholderUpdate": "Enter a new token to update the link",
    "modal.updateLink": "Update link",
    "modal.confirmLink": "Link account",
    "modal.repository": "Repository",
    "modal.newWorktree": "New Worktree",
    "modal.branch": "Branch",
    "modal.path": "Path",
    "modal.createBranch": "Create new branch",
    "modal.create": "Create",
    "modal.newProject": "New Project",
    "modal.local": "Local",
    "modal.remote": "Remote",
    "modal.localRepo": "Local repository",
    "modal.remoteUrl": "Remote URL",
    "modal.targetDir": "Target directory",
    "modal.dirName": "Directory name",
    "modal.autoInfer": "Auto infer",
    "modal.chooseDirectory": "Choose directory",
    "modal.add": "Add",
    "modal.clone": "Clone",
    "modal.cleanupCodeReview": "Clean CodeReview",
    "modal.cleanupQuestion": "Delete the temporary worktree and review/pr branch created for this review?",
    "modal.keep": "Keep",
    "modal.deleteTemp": "Delete temporary resources",
    "modal.updateFound": "New version found",
    "modal.detectedVersion": "New version {version} found",
    "modal.currentVersion": "Current version is {version}",
    "modal.noUpdateNotes": "This version has no update notes.",
    "modal.later": "Later",
    "modal.installRestart": "Install and restart",
    "modal.openReleasePage": "Open release page",
    "toast.scanned": "Scanned {count} repositories",
    "toast.refreshed": "{name} refreshed",
    "toast.pinned": "{name} pinned to top",
    "toast.unpinned": "{name} unpinned",
    "toast.providerLinked": "{provider} linked",
    "toast.languageChanged": "Language changed to {language}",
    "toast.cleanupPreference": "CodeReview cleanup policy set to {preference}",
    "toast.pathCopied": "Path copied",
    "toast.reviewApproved": "Review approved",
    "toast.reviewReset": "Review status reset",
    "toast.prReopened": "PR/MR reopened",
    "toast.prClosed": "PR/MR closed",
    "toast.prMerged": "PR/MR merged",
    "toast.commentSynced": "Comment synced to the Git platform",
    "toast.cleanupDone": "Temporary CodeReview worktree and branch cleaned",
    "toast.workspaceCreated": "Worktree created",
    "toast.projectAdded": "{name} added",
    "toast.workspaceRemoved": "Worktree removed",
    "toast.updateChecking": "Checking for updates...",
    "toast.currentLatest": "You are already on the latest version ({version}).",
    "toast.updateFound": "New version {version} found",
    "toast.updateFoundReleasePage": "New version {version} found. Open the release page to view it.",
    "toast.updateDetected": "New version detected: {version}",
    "update.downloading": "Downloading update...",
    "update.downloadingProgress": "Downloading update... {downloaded} / {total}",
    "update.installing": "Installing update...",
    "update.restart": "Update installed. Restarting...",
    "error.noRepoToken": "Select a repository and link a token first.",
    "error.directoryUnavailable": "Directory picker is unavailable",
    "error.copyFailed": "Copy failed",
    "error.operationFailed": "Operation failed",
    "error.updateManifest": "The update manifest for this channel is unavailable. Try again later.",
    "error.noRelease": "No release was found for the current channel."
  },
  "ja-JP": {
    "app.eyebrow": "Git Client",
    "app.subtitle": "Git Worktree とコードレビュー",
    "app.desktopOnlyUpdate": "更新確認はデスクトップアプリでのみ利用できます。",
    "app.developmentPreview": "開発プレビュー",
    "app.unknownVersion": "不明なバージョン",
    "nav.workspaces": "ワークスペース",
    "nav.codeReview": "コードレビュー",
    "nav.settings": "設定",
    "nav.expandSidebar": "サイドバーを展開",
    "nav.collapseSidebar": "サイドバーを折りたたむ",
    "nav.activeRepos": "アクティブ",
    "nav.activeReposTitle": "アクティブなリポジトリを表示",
    "nav.queue": "キュー",
    "nav.reviewQueueTitle": "コードレビューキューを表示",
    "topbar.workspacesTitle": "ワークスペース管理",
    "topbar.reviewTitle": "コードレビュー",
    "topbar.settingsTitle": "設定",
    "topbar.pickFolder": "ローカルフォルダを選択",
    "topbar.scanPlaceholder": "スキャンするディレクトリ",
    "topbar.scanDirectory": "ディレクトリをスキャン",
    "topbar.newProject": "新規プロジェクト",
    "layout.adjustSidebar": "サイドバー幅を調整",
    "layout.dragSidebar": "ドラッグしてサイドバー幅を調整",
    "filter.all": "すべてのプラットフォーム",
    "filter.platform": "Git プラットフォーム",
    "repo.searchPlaceholder": "リポジトリ、パス、リモート",
    "repo.filter": "フィルタ",
    "repo.collapseList": "リポジトリ一覧を折りたたむ",
    "repo.expandList": "リポジトリ一覧を展開",
    "repo.pin": "上部に固定",
    "repo.unpin": "固定を解除",
    "repo.adjustList": "リポジトリ一覧の幅を調整",
    "repo.dragList": "ドラッグしてリポジトリ一覧の幅を調整",
    "repo.worktrees": "Worktree",
    "repo.dirty": "変更あり",
    "repo.provider": "プロバイダー",
    "repo.giteeEnterprise": "Enterprise",
    "repo.localRepository": "ローカルリポジトリ",
    "repo.none": "なし",
    "repo.copyPath": "リポジトリパスをコピー",
    "repo.selectIde": "IDE を選択",
    "repo.open": "開く",
    "repo.openWith": "{editor} で開く",
    "repo.openFinder": "Finder で開く",
    "repo.finder": "Finder",
    "repo.newWorktree": "新規 Worktree",
    "repo.table.path": "パス",
    "repo.table.branch": "ブランチ",
    "repo.table.status": "状態",
    "repo.table.sync": "同期",
    "repo.refresh": "リポジトリを更新",
    "repo.noRepoTitle": "リポジトリ未読み込み",
    "repo.noRepoHint": "ディレクトリを選択してスキャン",
    "repo.noMatches": "現在のフィルタに一致するリポジトリはありません。",
    "repo.copyWorktreePath": "Worktree パスをコピー",
    "repo.remove": "削除",
    "repo.prunable": "削除可能",
    "repo.clean": "クリーン",
    "repo.detached": "Detached HEAD",
    "repo.bare": "Bare リポジトリ",
    "review.queueTitle": "コードレビューキュー",
    "review.refreshQueue": "コードレビューキューを更新",
    "review.searchPlaceholder": "番号、タイトル、リポジトリ、ブランチ",
    "review.collapseList": "レビュー一覧を折りたたむ",
    "review.expandList": "レビュー一覧を展開",
    "review.adjustList": "レビュー一覧の幅を調整",
    "review.dragList": "ドラッグしてレビュー一覧幅を調整",
    "review.noProvider": "このリポジトリには利用可能なレビューリモートがありません。",
    "review.tokenRequired": "設定で {provider} Token を連携すると実際のキューを読み込めます。",
    "review.emptyGroup": "このグループには PR/MR がありません。",
    "review.noMatches": "現在のフィルタに一致する PR/MR はありません。",
    "review.loading": "レビューを読み込み中...",
    "review.loadMore": "さらに読み込む",
    "review.openRemote": "リモートを開く",
    "review.mergeCode": "コードをマージ",
    "review.mergePr": "PR をマージ",
    "review.mergeMr": "MR をマージ",
    "review.mergeBlocked": "マージには承認とチェック通過が必要です",
    "review.waitingMerge": "マージ待ち",
    "review.changedFiles": "変更ファイル",
    "review.readonly": "読み取り専用",
    "review.noFileChanges": "API から変更ファイルが返されませんでした。",
    "review.loadingFileDiff": "ファイル差分を読み込み中...",
    "review.comment": "コメント",
    "review.you": "自分",
    "review.commentPlaceholder": "この変更行にレビューコメントを追加",
    "review.cancel": "キャンセル",
    "review.noTextDiff": "このファイルには表示できるテキスト差分がありません。",
    "review.showMoreFiles": "さらにファイルを表示（残り {count} 件）",
    "review.showMoreDiff": "さらに差分を表示（残り {count} 行）",
    "review.showUnchangedLines": "未変更行を表示",
    "review.hideUnchangedLines": "未変更行を折りたたむ",
    "review.unchangedLines": "{count} 行の未変更",
    "review.hiddenUnchangedLines": "{count} 行の未変更を折りたたみ済み",
    "review.approve": "レビュー承認",
    "review.unapprove": "承認を取り消す",
    "review.codeReview": "CodeReview",
    "review.closePr": "PR を閉じる",
    "review.reopen": "再オープン",
    "review.noSelectedTitle": "PR/MR が選択されていません",
    "review.noSelectedHint": "リポジトリを選択し Token を連携するとレビュー詳細を表示します",
    "review.filter.open": "オープン",
    "review.filter.closed": "クローズ",
    "review.filter.merged": "マージ済み",
    "review.filter.reverted": "リバート済み",
    "review.terminal.closed": "クローズ済み",
    "review.terminal.merged": "マージ済み",
    "review.terminal.reverted": "リバート済み",
    "review.terminal.open": "オープン",
    "review.state.passing": "チェック通過",
    "review.state.pending": "チェック中",
    "review.state.failed": "チェック失敗",
    "review.hint.closed": "このレビューは閉じられています。再オープンすると続行できます。",
    "review.hint.merged": "変更はマージ済みで、現在は読み取り専用です。",
    "review.hint.reverted": "変更はリバート済みで、現在は読み取り専用です。",
    "review.hint.canMerge": "マージ可能です",
    "review.hint.waiting": "レビュー条件を待っています",
    "settings.subtitle": "ホスティング、レビュー設定、言語、更新",
    "settings.version": "現在のバージョン",
    "settings.hosting": "ホスティング",
    "settings.linkedCount": "{linked}/{total} 連携済み",
    "settings.linked": "連携済み",
    "settings.preferences": "環境設定",
    "settings.preferencesHint": "画面、レビュー、更新",
    "settings.language": "アプリ言語",
    "settings.cleanup": "レビュー後の処理",
    "settings.checkUpdates": "更新を確認",
    "settings.cleanup.auto": "自動削除",
    "settings.cleanup.ask": "毎回確認",
    "settings.cleanup.keep": "保持",
    "settings.cleanup.autoDesc": "レビュー後に一時 Worktree とブランチを自動削除",
    "settings.cleanup.askDesc": "レビュー後に一時 Worktree とブランチを削除するか確認",
    "settings.cleanup.keepDesc": "レビュー後も一時 Worktree とブランチを保持",
    "settings.channel.dev": "開発チャンネル",
    "settings.channel.unknown": "不明なチャンネル",
    "settings.channel.preview": "Preview チャンネル",
    "settings.channel.stable": "Stable チャンネル",
    "modal.close": "閉じる",
    "modal.cancel": "キャンセル",
    "modal.save": "保存",
    "modal.providerTitle": "{provider} 連携",
    "modal.token": "Token",
    "modal.tokenPlaceholderNew": "アクセストークンを入力",
    "modal.tokenPlaceholderUpdate": "連携更新用の新しい Token を入力",
    "modal.updateLink": "連携を更新",
    "modal.confirmLink": "連携する",
    "modal.repository": "リポジトリ",
    "modal.newWorktree": "新規 Worktree",
    "modal.branch": "ブランチ",
    "modal.path": "パス",
    "modal.createBranch": "新しいブランチを作成",
    "modal.create": "作成",
    "modal.newProject": "新規プロジェクト",
    "modal.local": "ローカル",
    "modal.remote": "リモート",
    "modal.localRepo": "ローカルリポジトリ",
    "modal.remoteUrl": "リモート URL",
    "modal.targetDir": "保存先ディレクトリ",
    "modal.dirName": "ディレクトリ名",
    "modal.autoInfer": "自動推定",
    "modal.chooseDirectory": "ディレクトリを選択",
    "modal.add": "追加",
    "modal.clone": "Clone",
    "modal.cleanupCodeReview": "CodeReview をクリーンアップ",
    "modal.cleanupQuestion": "このレビュー用に作成された一時 Worktree と review/pr ブランチを削除しますか？",
    "modal.keep": "保持",
    "modal.deleteTemp": "一時リソースを削除",
    "modal.updateFound": "新しいバージョン",
    "modal.detectedVersion": "新しいバージョン {version} を検出",
    "modal.currentVersion": "現在のバージョンは {version}",
    "modal.noUpdateNotes": "このバージョンには更新内容がありません。",
    "modal.later": "後で",
    "modal.installRestart": "インストールして再起動",
    "modal.openReleasePage": "リリースページを開く",
    "toast.scanned": "{count} 件のリポジトリをスキャンしました",
    "toast.refreshed": "{name} を更新しました",
    "toast.pinned": "{name} を上部に固定しました",
    "toast.unpinned": "{name} の固定を解除しました",
    "toast.providerLinked": "{provider} を連携しました",
    "toast.languageChanged": "言語を {language} に切り替えました",
    "toast.cleanupPreference": "CodeReview のクリーンアップ方針を {preference} に設定しました",
    "toast.pathCopied": "パスをコピーしました",
    "toast.reviewApproved": "レビューを承認しました",
    "toast.reviewReset": "レビュー状態をリセットしました",
    "toast.prReopened": "PR/MR を再オープンしました",
    "toast.prClosed": "PR/MR を閉じました",
    "toast.prMerged": "PR/MR をマージしました",
    "toast.commentSynced": "コメントを Git プラットフォームに同期しました",
    "toast.cleanupDone": "CodeReview の一時 Worktree とブランチを削除しました",
    "toast.workspaceCreated": "Worktree を作成しました",
    "toast.projectAdded": "{name} を追加しました",
    "toast.workspaceRemoved": "Worktree を削除しました",
    "toast.updateChecking": "更新を確認中...",
    "toast.currentLatest": "すでに最新バージョンです（{version}）。",
    "toast.updateFound": "新しいバージョン {version} があります",
    "toast.updateFoundReleasePage": "新しいバージョン {version} があります。リリースページで確認できます。",
    "toast.updateDetected": "新しいバージョンを検出：{version}",
    "update.downloading": "更新をダウンロード中...",
    "update.downloadingProgress": "更新をダウンロード中... {downloaded} / {total}",
    "update.installing": "更新をインストール中...",
    "update.restart": "更新をインストールしました。再起動中...",
    "error.noRepoToken": "先にリポジトリを選択して Token を連携してください。",
    "error.directoryUnavailable": "ディレクトリ選択は利用できません",
    "error.copyFailed": "コピーに失敗しました",
    "error.operationFailed": "操作に失敗しました",
    "error.updateManifest": "現在のチャンネルの更新マニフェストを利用できません。後でもう一度お試しください。",
    "error.noRelease": "現在のチャンネルのリリースが見つかりません。"
  },
};

type I18nRuntime = {
  language: AppLanguage;
  t: (key: string, values?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nRuntime>({
  language: "zh-CN",
  t: (key) => I18N_MESSAGES["zh-CN"][key] ?? key,
});

function createI18n(language: AppLanguage): I18nRuntime {
  return {
    language,
    t: (key, values) => formatMessage(
      I18N_MESSAGES[language]?.[key] ?? I18N_MESSAGES["zh-CN"][key] ?? key,
      values,
    ),
  };
}

function useI18n() {
  return useContext(I18nContext);
}

function formatMessage(message: string, values?: Record<string, string | number>) {
  if (!values) return message;
  return Object.entries(values).reduce(
    (formatted, [key, value]) => formatted.split(`{${key}}`).join(String(value)),
    message,
  );
}

const demoRepositories: RepositoryInfo[] = [
  {
    name: "workflow-studio",
    root: "/Users/joe/Documents/WorkFlowStudio",
    common_dir: "/Users/joe/Documents/WorkFlowStudio/.git",
    current_branch: "main",
    provider: {
      kind: "github",
      display_name: "GitHub",
      remote_name: "origin",
      host: "github.com",
      owner: "team",
      repo: "workflow-studio",
      full_name: "team/workflow-studio",
      web_url: "https://github.com/team/workflow-studio",
      clone_url: "https://github.com/team/workflow-studio.git",
      capabilities: {
        approve_review: true,
        merge_pull_request: true,
        cleanup_worktree: true,
      },
    },
    worktrees: [
      {
        path: "/Users/joe/Documents/WorkFlowStudio",
        branch: "main",
        head: "7c2a9f1",
        detached: false,
        bare: false,
        prunable: null,
        status: { dirty: true, staged: 2, unstaged: 1, untracked: 3, ahead: 1, behind: 0, summary: "2 staged, 1 changed, 3 untracked" },
      },
      {
        path: "/Users/joe/Documents/WorkFlowStudio/.worktrees/review-418",
        branch: "review/pr-418",
        head: "a51d221",
        detached: false,
        bare: false,
        prunable: null,
        status: { dirty: false, staged: 0, unstaged: 0, untracked: 0, ahead: 0, behind: 0, summary: "clean" },
      },
    ],
  },
  {
    name: "payments-api",
    root: "/Users/joe/Documents/Work/payments-api",
    common_dir: "/Users/joe/Documents/Work/payments-api/.git",
    current_branch: "release/2026.05",
    provider: {
      kind: "gitlab",
      display_name: "GitLab",
      remote_name: "origin",
      host: "gitlab.company.dev",
      owner: "platform/payments",
      repo: "payments-api",
      full_name: "platform/payments/payments-api",
      web_url: "https://gitlab.company.dev/platform/payments/payments-api",
      clone_url: "https://gitlab.company.dev/platform/payments/payments-api.git",
      capabilities: {
        approve_review: true,
        reset_review: true,
        show_test_status: true,
        merge_pull_request: true,
      },
    },
    worktrees: [
      {
        path: "/Users/joe/Documents/Work/payments-api",
        branch: "release/2026.05",
        head: "4fa92bb",
        detached: false,
        bare: false,
        prunable: null,
        status: { dirty: false, staged: 0, unstaged: 0, untracked: 0, ahead: 0, behind: 2, summary: "clean" },
      },
    ],
  },
];

const demoPullRequests: PullRequestViewModel[] = [
  {
    number: 418,
    title: "Refine worktree cleanup after provider review",
    author: "chen.li",
    state: "open",
    queueStatus: "open",
    repositoryName: "workflow-studio",
    repositoryFullName: "team/workflow-studio",
    repositoryUrl: "https://github.com/team/workflow-studio",
    providerName: "GitHub",
    providerKind: "github",
    webUrl: "https://github.com/team/workflow-studio/pull/418",
    source: "feature/provider-review",
    target: "main",
    updatedAt: "12 min",
    checks: "passing",
    files: [
      { path: "src-tauri/src/repository.rs", status: "modified", additions: 74, deletions: 18, diff: demoDiff("src-tauri/src/repository.rs") },
      { path: "src/App.tsx", status: "modified", additions: 118, deletions: 42, diff: demoDiff("src/App.tsx") },
      { path: "docs/review-flow.md", status: "added", additions: 39, deletions: 0, diff: demoDiff("docs/review-flow.md") },
    ],
  },
  {
    number: 416,
    title: "Add local clone validation for remote projects",
    author: "maria",
    state: "approved",
    queueStatus: "merged",
    repositoryName: "workflow-studio",
    repositoryFullName: "team/workflow-studio",
    repositoryUrl: "https://github.com/team/workflow-studio",
    providerName: "GitHub",
    providerKind: "github",
    webUrl: "https://github.com/team/workflow-studio/pull/416",
    source: "feature/clone-validation",
    target: "main",
    updatedAt: "44 min",
    checks: "passing",
    files: [
      { path: "src-tauri/src/git.rs", status: "modified", additions: 31, deletions: 7, diff: demoDiff("src-tauri/src/git.rs") },
      { path: "src-tauri/src/models.rs", status: "modified", additions: 16, deletions: 0, diff: demoDiff("src-tauri/src/models.rs") },
    ],
  },
  {
    number: 409,
    title: "Split settings into platform and IDE panels",
    author: "alex",
    state: "blocked",
    queueStatus: "closed",
    repositoryName: "payments-api",
    repositoryFullName: "platform/payments/payments-api",
    repositoryUrl: "https://gitlab.company.dev/platform/payments/payments-api",
    providerName: "GitLab",
    providerKind: "gitlab",
    webUrl: "https://gitlab.company.dev/platform/payments/payments-api/-/merge_requests/409",
    source: "settings-refresh",
    target: "develop",
    updatedAt: "2 h",
    checks: "failed",
    files: [
      { path: "src/styles.css", status: "modified", additions: 66, deletions: 21, diff: demoDiff("src/styles.css") },
      { path: "src/App.tsx", status: "modified", additions: 53, deletions: 15, diff: demoDiff("src/App.tsx") },
    ],
  },
  {
    number: 397,
    title: "Revert experimental worktree status cache",
    author: "nora",
    state: "blocked",
    queueStatus: "reverted",
    repositoryName: "payments-api",
    repositoryFullName: "platform/payments/payments-api",
    repositoryUrl: "https://gitlab.company.dev/platform/payments/payments-api",
    providerName: "GitLab",
    providerKind: "gitlab",
    webUrl: "https://gitlab.company.dev/platform/payments/payments-api/-/merge_requests/397",
    source: "revert/status-cache",
    target: "develop",
    updatedAt: "1 d",
    checks: "failed",
    files: [
      { path: "src-tauri/src/status.rs", status: "modified", additions: 12, deletions: 48, diff: demoDiff("src-tauri/src/status.rs") },
      { path: "src-tauri/src/cache.rs", status: "deleted", additions: 0, deletions: 83, diff: demoDiff("src-tauri/src/cache.rs") },
    ],
  },
];

function getMediaQueryMatches(query: string) {
  return window.matchMedia(query).matches;
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => getMediaQueryMatches(query));

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const updateMatches = () => setMatches(mediaQuery.matches);

    updateMatches();
    mediaQuery.addEventListener("change", updateMatches);
    return () => mediaQuery.removeEventListener("change", updateMatches);
  }, [query]);

  return matches;
}

function App() {
  const [activeView, setActiveView] = useState<View>("workspaces");
  const [scannedRepositories, setScannedRepositories] = useState<RepositoryInfo[]>(isTauri ? [] : demoRepositories);
  const [pinnedRepositories, setPinnedRepositories] = useState<RepositoryInfo[]>(loadPinnedRepositories);
  const [selectedRepoPath, setSelectedRepoPath] = useState(isTauri ? "" : demoRepositories[0].root);
  const [scanRoot, setScanRoot] = useState("/Users/joe/Documents/Work");
  const [initialWorkspaceFilters] = useState(loadWorkspaceFilterPreferences);
  const [searchQuery, setSearchQuery] = useState(initialWorkspaceFilters.searchQuery);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [repoPlatformSelection, setRepoPlatformSelection] = useState<GitPlatformSelection>(initialWorkspaceFilters.platformSelection);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<PendingUpdate | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [currentAppVersion, setCurrentAppVersion] = useState("");
  const [worktreeModalOpen, setWorktreeModalOpen] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [workspaceIde, setWorkspaceIde] = useState(loadWorkspaceIdePreference);
  const [repositoryGiteeEnterprise, setRepositoryGiteeEnterprise] = useState<Record<string, boolean>>(loadRepositoryGiteeEnterprisePreferences);
  const [providerTokens, setProviderTokens] = useState<Record<ReviewProviderKind, string>>(loadProviderTokenPreferences);
  const [providerModalKind, setProviderModalKind] = useState<ReviewProviderKind | null>(null);
  const [language, setLanguage] = useState<AppLanguage>(loadLanguagePreference);
  const [codeReviewCleanupPreference, setCodeReviewCleanupPreference] = useState<CodeReviewCleanupPreference>(loadCodeReviewCleanupPreference);
  const [pendingCodeReviewCleanup, setPendingCodeReviewCleanup] = useState<PullRequestViewModel | null>(null);
  const [reviewQueues, setReviewQueues] = useState<Record<ReviewQueueStatus, ReviewQueueState>>(
    () => isTauri ? createEmptyReviewQueues() : createDemoReviewQueues(),
  );
  const [reviewStateOverrides, setReviewStateOverrides] = useState<Record<string, PullRequestViewModel["state"]>>(loadReviewStateOverrides);
  const [selectedPr, setSelectedPr] = useState<number | null>(isTauri ? null : demoPullRequests[0].number);
  const [initialReviewFilters] = useState(loadReviewFilterPreferences);
  const [reviewQueueFilter, setReviewQueueFilter] = useState<ReviewQueueStatus>(initialReviewFilters.queueFilter);
  const [reviewSearchQuery, setReviewSearchQuery] = useState(initialReviewFilters.searchQuery);
  const deferredReviewSearchQuery = useDeferredValue(reviewSearchQuery);
  const [reviewPlatformSelection, setReviewPlatformSelection] = useState<GitPlatformSelection>(initialReviewFilters.platformSelection);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewFilesLoading, setReviewFilesLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const compactSplitLayout = useMediaQuery(COMPACT_SPLIT_LAYOUT_QUERY);
  const [sidebarWidth, setSidebarWidth] = useState(244);
  const [repoPanelWidth, setRepoPanelWidth] = useState(348);
  const [reviewListWidth, setReviewListWidth] = useState(360);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [repoPanelCollapsed, setRepoPanelCollapsed] = useState(compactSplitLayout);
  const [reviewListCollapsed, setReviewListCollapsed] = useState(compactSplitLayout);
  const [, startNavigationTransition] = useTransition();

  const repositories = useMemo(
    () => orderRepositories(scannedRepositories, pinnedRepositories),
    [scannedRepositories, pinnedRepositories],
  );

  const pinnedRepositoryIds = useMemo(
    () => new Set(pinnedRepositories.map((repo) => repo.common_dir)),
    [pinnedRepositories],
  );

  const visibleRepositories = useMemo(() => {
    const query = deferredSearchQuery.trim().toLowerCase();
    return repositories.filter((repo) => {
      const matchesQuery = !query || [repo.name, repo.root, repo.provider?.full_name ?? "", repo.provider?.display_name ?? "", repo.provider?.host ?? ""]
        .some((value) => value.toLowerCase().includes(query));
      const matchesPlatform = matchesPlatformSelection(getPlatformFilterKey(repo.provider), repoPlatformSelection);
      return matchesQuery && matchesPlatform;
    });
  }, [repositories, deferredSearchQuery, repoPlatformSelection]);

  const selectedRepo = repositories.find((repo) => repo.root === selectedRepoPath) ?? repositories[0];
  const providerModal = providerModalKind ? getHostingProvider(providerModalKind) : null;
  const activeProviderToken = selectedRepo?.provider ? providerTokens[selectedRepo.provider.kind]?.trim() ?? "" : "";
  const pullRequests = useMemo(
    () => REVIEW_QUEUE_FILTERS.flatMap((filter) => reviewQueues[filter.value].items),
    [reviewQueues],
  );
  const currentReviewQueue = reviewQueues[reviewQueueFilter];
  const visibleReviewPullRequests = useMemo(() => {
    const query = deferredReviewSearchQuery.trim().toLowerCase();
    return currentReviewQueue.items.filter((pullRequest) => {
      const matchesQuery = !query || [
        `#${pullRequest.number}`,
        pullRequest.title,
        pullRequest.author,
        pullRequest.repositoryName,
        pullRequest.repositoryFullName,
        pullRequest.source,
        pullRequest.target,
        pullRequest.providerName,
      ].some((value) => value.toLowerCase().includes(query));
      const matchesPlatform = matchesPlatformSelection(pullRequest.providerKind, reviewPlatformSelection);
      return matchesQuery && matchesPlatform;
    });
  }, [currentReviewQueue.items, deferredReviewSearchQuery, reviewPlatformSelection]);
  const reviewQueueCounts = useMemo(
    () => REVIEW_QUEUE_FILTERS.reduce((counts, filter) => {
      const queue = reviewQueues[filter.value];
      counts[filter.value] = queue.loaded ? String(queue.items.length) : "-";
      return counts;
    }, {} as Record<ReviewQueueStatus, string>),
    [reviewQueues],
  );
  const selectedPullRequest = selectedPr == null
    ? currentReviewQueue.items[0]
    : currentReviewQueue.items.find((item) => item.number === selectedPr) ?? currentReviewQueue.items[0];
  const i18n = useMemo(() => createI18n(language), [language]);
  const { t } = i18n;
  const appShellStyle = {
    "--sidebar-width": `${sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth}px`,
    "--sidebar-resizer-width": sidebarCollapsed ? "0px" : "6px",
    "--repo-panel-width": `${repoPanelCollapsed ? 0 : repoPanelWidth}px`,
    "--repo-resizer-width": repoPanelCollapsed ? "0px" : "6px",
    "--review-list-width": `${reviewListCollapsed ? 0 : reviewListWidth}px`,
    "--review-resizer-width": reviewListCollapsed ? "0px" : "6px",
  } as CSSProperties;
  const promptedUpdateVersionRef = useRef(loadPromptedUpdateVersion());
  const updateCheckInFlightRef = useRef(false);
  const pendingManualUpdateCheckRef = useRef(false);
  const currentAppVersionRef = useRef("");
  const pendingUpdaterRef = useRef<Update | null>(null);
  const reviewStateOverridesRef = useRef(reviewStateOverrides);
  const reviewQueueRequestIdRef = useRef(0);
  const workspaceOperationInFlightRef = useRef(false);
  const reviewActionInFlightRef = useRef(false);
  const reviewQueueInFlightRef = useRef<{ key: string; generation: number } | null>(null);
  const autoCompactRepoPanelRef = useRef(compactSplitLayout);
  const autoCompactReviewListRef = useRef(compactSplitLayout);

  useEffect(() => {
    if (compactSplitLayout) {
      setRepoPanelCollapsed((current) => {
        if (current) return current;
        autoCompactRepoPanelRef.current = true;
        return true;
      });
      setReviewListCollapsed((current) => {
        if (current) return current;
        autoCompactReviewListRef.current = true;
        return true;
      });
      return;
    }

    if (autoCompactRepoPanelRef.current) {
      autoCompactRepoPanelRef.current = false;
      setRepoPanelCollapsed(false);
    }
    if (autoCompactReviewListRef.current) {
      autoCompactReviewListRef.current = false;
      setReviewListCollapsed(false);
    }
  }, [compactSplitLayout]);

  useEffect(() => {
    if (toast) {
      const timer = window.setTimeout(() => setToast(null), 3600);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [toast]);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    persistWorkspaceFilterPreferences({
      searchQuery,
      platformSelection: repoPlatformSelection,
    });
  }, [searchQuery, repoPlatformSelection]);

  useEffect(() => {
    persistReviewFilterPreferences({
      searchQuery: reviewSearchQuery,
      platformSelection: reviewPlatformSelection,
      queueFilter: reviewQueueFilter,
    });
  }, [reviewSearchQuery, reviewPlatformSelection, reviewQueueFilter]);

  useEffect(() => {
    reviewStateOverridesRef.current = reviewStateOverrides;
  }, [reviewStateOverrides]);

  useEffect(() => {
    if (!isTauri) return undefined;

    const onStorage = (event: StorageEvent) => {
      if (event.key === UPDATE_PROMPTED_VERSION_KEY) {
        promptedUpdateVersionRef.current = loadPromptedUpdateVersion();
      }
    };
    const onFocus = () => {
      promptedUpdateVersionRef.current = loadPromptedUpdateVersion();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    if (!isTauri) return undefined;

    let cancelled = false;

    void getVersion().then((version) => {
      if (!cancelled) {
        currentAppVersionRef.current = version;
        setCurrentAppVersion(version);
      }
    }).catch(() => {
      if (!cancelled) {
        currentAppVersionRef.current = "";
        setCurrentAppVersion(t("app.unknownVersion"));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    if (!isTauri) return undefined;

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
  }, []);

  useEffect(() => {
    if (!isTauri) return undefined;

    return () => {
      void disposePendingUpdater();
    };
  }, []);

  useEffect(() => {
    if (!isTauri) return undefined;

    const timer = window.setTimeout(() => {
      const cached = loadCachedScanResult();
      if (!cached) return;

      const nextPinned = refreshPinnedRepositories(cached.repositories, pinnedRepositories);
      setPinnedRepositoryState(nextPinned);
      setScannedRepositories(cached.repositories);
      setScanRoot(cached.root);
      setSelectedRepoPath((current) =>
        cached.repositories.some((repo) => repo.root === current)
          ? current
          : cached.repositories[0]?.root ?? "",
      );
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    setReviewQueues(createEmptyReviewQueues());
    setSelectedPr(null);
    setReviewError(null);
    reviewQueueRequestIdRef.current += 1;

    if (activeView !== "review") {
      return;
    }

    if (!selectedRepo?.provider) {
      if (activeView === "review") {
        setReviewError(t("review.noProvider"));
      }
      return;
    }

    if (!activeProviderToken) {
      if (activeView === "review") {
        setReviewError(t("review.tokenRequired", { provider: selectedRepo.provider.display_name }));
      }
      return;
    }

    void loadReviewQueue(reviewQueueFilter, {
      repo: selectedRepo,
      accessToken: activeProviderToken,
      force: true,
    });
  }, [activeView, selectedRepo?.root, selectedRepo?.provider?.kind, activeProviderToken, t]);

  useEffect(() => {
    if (!isTauri || !selectedRepo?.provider || !activeProviderToken || !selectedPullRequest) return;

    let cancelled = false;
    setReviewFilesLoading(true);

    Promise.all([
      call<PullRequestInfo>("get_pull_request_detail", {
        request: {
          repo_path: selectedRepo.root,
          access_token: activeProviderToken,
          number: selectedPullRequest.number,
        },
      }),
      call<PullRequestChangedFileInfo[]>("list_pull_request_files", {
        request: {
          repo_path: selectedRepo.root,
          access_token: activeProviderToken,
          number: selectedPullRequest.number,
        },
      }),
    ])
      .then(([detail, files]) => {
        if (cancelled) return;
        const mapped = applyReviewStateOverride(
          mapPullRequest(selectedRepo, detail, selectedPullRequest.queueStatus, files),
        );
        setReviewQueues((current) => ({
          ...current,
          [mapped.queueStatus]: {
            ...current[mapped.queueStatus],
            items: current[mapped.queueStatus].items.map((item) => (
              item.number === mapped.number && item.repositoryFullName === mapped.repositoryFullName
                ? mapped
                : item
            )),
          },
        }));
        setReviewError(null);
      })
      .catch((error) => {
        if (!cancelled) setReviewError(getErrorMessage(error, t("error.operationFailed")));
      })
      .finally(() => {
        if (!cancelled) setReviewFilesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedRepo?.root, activeProviderToken, selectedPullRequest?.number]);

  async function runScan(root = scanRoot) {
    const normalizedRoot = root.trim();
    if (!normalizedRoot) return;
    await runWorkspaceOperation(async () => {
      try {
        const result = await call<ScanResult>("scan_directory", { root: normalizedRoot });
        const nextPinned = refreshPinnedRepositories(result.repositories, pinnedRepositories);
        setPinnedRepositoryState(nextPinned);
        const nextRepositories = orderRepositories(result.repositories, nextPinned);
        setScannedRepositories(result.repositories);
        setScanRoot(result.root);
        persistCachedScanResult(result);
        setSelectedRepoPath((current) =>
          nextRepositories.some((repo) => repo.root === current)
            ? current
            : nextRepositories[0]?.root ?? "",
        );
        showToast("success", t("toast.scanned", { count: result.repositories.length }));
      } catch (error) {
        showToast("error", getErrorMessage(error, t("error.operationFailed")));
      }
    });
  }

  async function pickScanRoot() {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") {
        setScanRoot(selected);
        await runScan(selected);
      }
    } catch (error) {
      showToast("error", getErrorMessage(error, t("error.operationFailed")));
    }
  }

  async function refreshRepository(repo = selectedRepo) {
    if (!repo) return;
    await runWorkspaceOperation(async () => {
      try {
        const refreshed = await call<RepositoryInfo>("inspect_path", { path: repo.root });
        updateRepository(refreshed);
        showToast("success", t("toast.refreshed", { name: refreshed.name }));
      } catch (error) {
        showToast("error", getErrorMessage(error, t("error.operationFailed")));
      }
    });
  }

  function updateRepository(repo: RepositoryInfo, options: { addToScan?: boolean } = {}) {
    if (pinnedRepositoryIds.has(repo.common_dir)) {
      setPinnedRepositoryState(upsertRepositoryList(pinnedRepositories, repo));
    }

    setScannedRepositories((current) => {
      const exists = current.some((item) => item.common_dir === repo.common_dir);
      const next = !exists && options.addToScan
        ? [repo, ...current]
        : !exists
          ? current
          : current.map((item) => (item.common_dir === repo.common_dir ? repo : item));
      persistCachedScanResult({ root: scanRoot, repositories: next });
      return next;
    });
    setSelectedRepoPath(repo.root);
  }

  function toggleRepositoryPin(repo: RepositoryInfo) {
    const pinned = pinnedRepositoryIds.has(repo.common_dir);
    const nextPinned = pinned
      ? pinnedRepositories.filter((item) => item.common_dir !== repo.common_dir)
      : [repo, ...pinnedRepositories];

    setPinnedRepositoryState(nextPinned);
    showToast("success", pinned
      ? t("toast.unpinned", { name: repo.name })
      : t("toast.pinned", { name: repo.name }));

    if (pinned && !scannedRepositories.some((item) => item.common_dir === repo.common_dir)) {
      const nextRepositories = orderRepositories(scannedRepositories, nextPinned);
      setSelectedRepoPath((current) =>
        current === repo.root ? nextRepositories[0]?.root ?? "" : current,
      );
    }
  }

  function setPinnedRepositoryState(nextPinned: RepositoryInfo[]) {
    const uniquePinned = uniqueRepositories(nextPinned);
    setPinnedRepositories(uniquePinned);
    persistPinnedRepositories(uniquePinned);
  }

  function changeWorkspaceIde(nextIde: string) {
    if (!isIdeValue(nextIde)) return;
    setWorkspaceIde(nextIde);
    persistWorkspaceIdePreference(nextIde);
  }

  function changeRepositoryGiteeEnterprise(repo: RepositoryInfo, enabled: boolean) {
    if (repo.provider?.kind === "gitee") {
      setRepositoryGiteeEnterprise((current) => {
        const next = { ...current, [repo.common_dir]: enabled };
        persistRepositoryGiteeEnterprisePreferences(next);
        return next;
      });
    }
  }

  function saveProviderToken(kind: ReviewProviderKind, token: string) {
    const normalizedToken = token.trim();
    if (!normalizedToken) return;
    setProviderTokens((current) => {
      const next = { ...current, [kind]: normalizedToken };
      persistProviderTokenPreferences(next);
      return next;
    });
    setProviderModalKind(null);
    showToast("success", t("toast.providerLinked", { provider: getHostingProvider(kind).name }));
  }

  function changeLanguage(nextLanguage: AppLanguage) {
    setLanguage(nextLanguage);
    persistLanguagePreference(nextLanguage);
    showToast("success", t("toast.languageChanged", { language: getLanguageLabel(nextLanguage) }));
  }

  function changeCodeReviewCleanupPreference(nextPreference: CodeReviewCleanupPreference) {
    setCodeReviewCleanupPreference(nextPreference);
    persistCodeReviewCleanupPreference(nextPreference);
    showToast("success", t("toast.cleanupPreference", { preference: getCodeReviewCleanupLabel(nextPreference, t) }));
  }

  async function copyPath(path: string) {
    try {
      if (isTauri) {
        await call<void>("copy_text", { text: path });
      } else {
        await copyText(path, t("error.copyFailed"));
      }
      showToast("success", t("toast.pathCopied"));
    } catch (error) {
      showToast("error", getErrorMessage(error, t("error.operationFailed")));
    }
  }

  async function runWorkspaceOperation(operation: () => Promise<void>) {
    if (workspaceOperationInFlightRef.current) return;
    workspaceOperationInFlightRef.current = true;
    setLoading(true);
    try {
      await operation();
    } finally {
      workspaceOperationInFlightRef.current = false;
      setLoading(false);
    }
  }

  async function loadReviewQueue(
    state: ReviewQueueStatus = reviewQueueFilter,
    options: {
      repo?: RepositoryInfo;
      accessToken?: string;
      append?: boolean;
      force?: boolean;
    } = {},
  ) {
    const repo = options.repo ?? selectedRepo;
    const accessToken = options.accessToken ?? activeProviderToken;
    if (!repo?.provider || !accessToken) return;

    const queue = reviewQueues[state];
    if (!options.force && !options.append && queue.loaded) {
      setReviewError(null);
      setSelectedPr((current) => (
        current != null && queue.items.some((item) => item.number === current)
          ? current
          : queue.items[0]?.number ?? null
      ));
      return;
    }
    if (options.append && !queue.hasMore) return;

    const targetPage = options.append ? queue.page + 1 : 1;
    const requestKey = `${repo.root}:${state}:${targetPage}:${options.append ? "append" : "replace"}`;
    const inFlightQueueRequest = reviewQueueInFlightRef.current;
    if (inFlightQueueRequest?.key === requestKey && inFlightQueueRequest.generation === reviewQueueRequestIdRef.current) {
      return;
    }

    setReviewLoading(true);
    setReviewError(null);
    const requestId = ++reviewQueueRequestIdRef.current;
    reviewQueueInFlightRef.current = { key: requestKey, generation: requestId };

    try {
      const page = await call<PullRequestPage>("list_pull_requests", {
        request: {
          repo_path: repo.root,
          access_token: accessToken,
          state,
          page: targetPage,
          per_page: REVIEW_PAGE_SIZE,
        },
      });
      const pageItems = page.items.map((item) => applyReviewStateOverride(mapPullRequest(repo, item, state)));
      if (requestId !== reviewQueueRequestIdRef.current) return;
      const previousItems = options.append ? queue.items : [];
      const nextItems = options.append
        ? [
            ...previousItems,
            ...pageItems.filter((item) => !previousItems.some((current) => current.number === item.number)),
          ]
        : pageItems;

      setReviewQueues((current) => ({
        ...current,
        [state]: {
          items: nextItems,
          page: page.page,
          hasMore: page.has_more,
          loaded: true,
        },
      }));
      setSelectedPr((current) =>
        current != null && nextItems.some((item) => item.number === current)
          ? current
          : nextItems[0]?.number ?? null,
      );
    } catch (error) {
      if (requestId !== reviewQueueRequestIdRef.current) return;
      if (!options.append) {
        setReviewQueues((current) => ({
          ...current,
          [state]: {
            ...createEmptyReviewQueueState(),
            loaded: true,
          },
        }));
      }
      setSelectedPr(null);
      setReviewError(getErrorMessage(error, t("error.operationFailed")));
    } finally {
      const inFlight = reviewQueueInFlightRef.current;
      if (inFlight?.key === requestKey && inFlight.generation === requestId) {
        reviewQueueInFlightRef.current = null;
      }
      if (requestId === reviewQueueRequestIdRef.current) {
        setReviewLoading(false);
      }
    }
  }

  function changeReviewQueueFilter(nextFilter: ReviewQueueStatus) {
    const queue = reviewQueues[nextFilter];
    startNavigationTransition(() => {
      setReviewQueueFilter(nextFilter);
      setSelectedPr(queue.items[0]?.number ?? null);
    });
    if (queue.loaded) {
      setReviewError(null);
    }

    if (isTauri && selectedRepo?.provider && activeProviderToken && !queue.loaded) {
      void loadReviewQueue(nextFilter, {
        repo: selectedRepo,
        accessToken: activeProviderToken,
      });
    }
  }

  async function runPullRequestAction(
    command: "approve_pull_request_review" | "reset_pull_request_review" | "reopen_pull_request" | "close_pull_request" | "merge_pull_request",
    pullRequest: PullRequestViewModel,
  ) {
    if (!selectedRepo?.provider || !activeProviderToken) return;
    if (reviewActionInFlightRef.current) return;

    const messages: Record<typeof command, string> = {
      approve_pull_request_review: t("toast.reviewApproved"),
      reset_pull_request_review: t("toast.reviewReset"),
      reopen_pull_request: t("toast.prReopened"),
      close_pull_request: t("toast.prClosed"),
      merge_pull_request: t("toast.prMerged"),
    };

    reviewActionInFlightRef.current = true;
    setReviewLoading(true);
    try {
      const updated = await call<RepositoryInfo>(command, {
        request: {
          repo_path: selectedRepo.root,
          access_token: activeProviderToken,
          number: pullRequest.number,
        },
      });
      updateRepository(updated);
      showToast("success", messages[command]);
      if (command === "approve_pull_request_review") {
        patchPullRequestReviewState(pullRequest, "approved");
      } else if (command === "reset_pull_request_review") {
        patchPullRequestReviewState(pullRequest, "open");
      }
      await loadReviewQueue(reviewQueueFilter, {
        repo: updated,
        accessToken: activeProviderToken,
        force: true,
      });
      if (command === "close_pull_request" || command === "merge_pull_request") {
        handleCodeReviewCompleted(pullRequest);
      }
    } catch (error) {
      showToast("error", getErrorMessage(error, t("error.operationFailed")));
    } finally {
      reviewActionInFlightRef.current = false;
      setReviewLoading(false);
    }
  }

  function patchPullRequestReviewState(
    pullRequest: PullRequestViewModel,
    nextState: PullRequestViewModel["state"],
  ) {
    const overrideKey = getPullRequestStateKey(pullRequest.repositoryFullName, pullRequest.number);
    const nextOverrides = { ...reviewStateOverridesRef.current, [overrideKey]: nextState };
    reviewStateOverridesRef.current = nextOverrides;
    setReviewStateOverrides(nextOverrides);
    persistReviewStateOverrides(nextOverrides);
    setReviewQueues((current) => {
      const nextQueues = { ...current };
      for (const filter of REVIEW_QUEUE_FILTERS) {
        const queue = current[filter.value];
        nextQueues[filter.value] = {
          ...queue,
          items: queue.items.map((item) => (
            item.number === pullRequest.number && item.repositoryFullName === pullRequest.repositoryFullName
              ? { ...item, state: nextState }
              : item
          )),
        };
      }
      return nextQueues;
    });
  }

  function applyReviewStateOverride(pullRequest: PullRequestViewModel) {
    const override = reviewStateOverridesRef.current[getPullRequestStateKey(
      pullRequest.repositoryFullName,
      pullRequest.number,
    )];
    return override && override !== pullRequest.state
      ? { ...pullRequest, state: override }
      : pullRequest;
  }

  function handleCodeReviewCompleted(pullRequest: PullRequestViewModel) {
    if (codeReviewCleanupPreference === "keep") return;
    if (codeReviewCleanupPreference === "ask") {
      setPendingCodeReviewCleanup(pullRequest);
      return;
    }
    void cleanupCodeReviewWorktree(pullRequest);
  }

  async function cleanupCodeReviewWorktree(pullRequest: PullRequestViewModel) {
    if (!selectedRepo?.provider || !activeProviderToken) return;
    if (reviewActionInFlightRef.current) return;

    reviewActionInFlightRef.current = true;
    setReviewLoading(true);
    try {
      const refreshed = await call<RepositoryInfo>("cleanup_code_review_worktree", {
        request: {
          repo_path: selectedRepo.root,
          access_token: activeProviderToken,
          number: pullRequest.number,
        },
      });
      updateRepository(refreshed);
      showToast("success", t("toast.cleanupDone"));
    } catch (error) {
      showToast("error", getErrorMessage(error, t("error.operationFailed")));
    } finally {
      reviewActionInFlightRef.current = false;
      setPendingCodeReviewCleanup(null);
      setReviewLoading(false);
    }
  }

  async function loadPullRequestFileContent(
    pullRequest: PullRequestViewModel,
    file: ReviewFileViewModel,
  ) {
    if (!selectedRepo?.provider || !activeProviderToken) {
      throw new Error(t("error.noRepoToken"));
    }

    const content = await call<PullRequestFileContentInfo>("get_pull_request_file_content", {
      request: {
        repo_path: selectedRepo.root,
        access_token: activeProviderToken,
        number: pullRequest.number,
        filename: file.path,
      },
    });

    return mapPullRequestFileContent(content);
  }

  async function createPullRequestComment(
    pullRequest: PullRequestViewModel,
    comment: PullRequestCommentInput,
  ) {
    if (!selectedRepo?.provider || !activeProviderToken) {
      throw new Error(t("error.noRepoToken"));
    }

    try {
      await call<void>("create_pull_request_comment", {
        request: {
          repo_path: selectedRepo.root,
          access_token: activeProviderToken,
          number: pullRequest.number,
          filename: comment.filename,
          line_index: comment.lineIndex,
          line_text: comment.lineText,
          body: comment.body,
        },
      });
      showToast("success", t("toast.commentSynced"));
    } catch (error) {
      const message = getErrorMessage(error, t("error.operationFailed"));
      showToast("error", message);
      throw new Error(message);
    }
  }

  async function startCodeReview(pullRequest: PullRequestViewModel) {
    if (!selectedRepo?.provider || !activeProviderToken) return;
    if (reviewActionInFlightRef.current) return;

    reviewActionInFlightRef.current = true;
    setReviewLoading(true);
    try {
      const review = await call<CodeReviewResult>("prepare_code_review", {
        request: {
          repo_path: selectedRepo.root,
          access_token: activeProviderToken,
          number: pullRequest.number,
        },
      });
      await call<void>("open_path", {
        request: {
          path: review.worktree_path,
          editor: workspaceIde,
          custom_command: null,
        },
      });
      showToast("success", `${t("toast.workspaceCreated")}：${review.review_branch}`);
      await loadReviewQueue(reviewQueueFilter, {
        repo: selectedRepo,
        accessToken: activeProviderToken,
        force: true,
      });
    } catch (error) {
      showToast("error", getErrorMessage(error, t("error.operationFailed")));
    } finally {
      reviewActionInFlightRef.current = false;
      setReviewLoading(false);
    }
  }

  function rememberPromptedUpdateVersion(version: string) {
    promptedUpdateVersionRef.current = version;
    savePromptedUpdateVersion(version);
  }

  async function disposePendingUpdater() {
    const current = pendingUpdaterRef.current;
    pendingUpdaterRef.current = null;

    if (!current) return;

    try {
      await current.close();
    } catch {
      // Closing an updater handle is best-effort; stale handles are cleared above.
    }
  }

  async function dismissPendingUpdate() {
    setPendingUpdate(null);
    setUpdateMessage(null);
    await disposePendingUpdater();
  }

  async function installPendingUpdate() {
    const update = pendingUpdaterRef.current;
    if (!update) {
      const releasePageUrl = pendingUpdate?.releasePageUrl;
      if (!releasePageUrl) return;

      try {
        await call("open_url", { request: { url: releasePageUrl } });
        setPendingUpdate(null);
      } catch (error) {
        showToast("error", getErrorMessage(error, t("error.operationFailed")));
      }
      return;
    }

    setPendingUpdate(null);
    setUpdateBusy(true);

    let downloadedBytes = 0;
    let totalBytes = 0;

    try {
      setUpdateMessage(t("update.downloading"));

      await update.downloadAndInstall((progress: DownloadEvent) => {
        if (progress.event === "Started") {
          downloadedBytes = 0;
          totalBytes = progress.data.contentLength ?? 0;
        } else if (progress.event === "Progress") {
          downloadedBytes += progress.data.chunkLength ?? 0;
        } else if (progress.event === "Finished") {
          setUpdateMessage(t("update.installing"));
          return;
        }

        const nextStatus = totalBytes > 0
          ? t("update.downloadingProgress", {
              downloaded: formatByteSize(Math.min(downloadedBytes, totalBytes)),
              total: formatByteSize(totalBytes),
            })
          : t("update.downloading");
        setUpdateMessage(nextStatus);
      });

      pendingUpdaterRef.current = null;
      setUpdateMessage(t("update.restart"));
      await relaunch();
    } catch (error) {
      showToast("error", getErrorMessage(error, t("error.operationFailed")));
      if (pendingUpdaterRef.current === update) {
        pendingUpdaterRef.current = null;
      }
      try {
        await update.close();
      } catch {
        // Nothing else to do if the updater handle was already consumed.
      }
    } finally {
      setUpdateBusy(false);
      setUpdateMessage(null);
    }
  }

  async function checkForUpdates(source: "auto" | "manual") {
    if (!isTauri) {
      if (source === "manual") {
        showToast("info", t("app.desktopOnlyUpdate"));
      }
      return;
    }

    if (updateCheckInFlightRef.current) {
      if (source === "manual") {
        pendingManualUpdateCheckRef.current = true;
        showToast("info", t("toast.updateChecking"));
      }
      return;
    }

    updateCheckInFlightRef.current = true;

    try {
      if (source === "manual") {
        setUpdateBusy(true);
        setUpdateMessage(t("toast.updateChecking"));
      }

      const release = await call<ReleaseCheckResult>("check_for_app_update");
      if (!release.has_update) {
        if (source === "manual") {
          const currentVersion = release.current_version || currentAppVersionRef.current || t("settings.version");
          showToast("success", t("toast.currentLatest", { version: currentVersion }));
        }
        return;
      }

      const alreadyPrompted = promptedUpdateVersionRef.current === release.latest_version;
      if (source === "auto" && alreadyPrompted) {
        return;
      }

      await disposePendingUpdater();

      let update: Update | null = null;
      try {
        update = await check();
      } catch {
        update = null;
      }

      if (update) {
        pendingUpdaterRef.current = update;
      }

      const nextPendingUpdate: PendingUpdate = update
        ? {
            version: update.version,
            currentVersion: update.currentVersion,
            body: update.body ?? release.release_notes ?? null,
            date: update.date ?? release.published_at ?? null,
            source,
            releasePageUrl: release.release_page_url,
            installable: true,
          }
        : {
            version: release.latest_version,
            currentVersion: release.current_version,
            body: release.release_notes ?? null,
            date: release.published_at ?? null,
            source,
            releasePageUrl: release.release_page_url,
            installable: false,
          };

      if (source === "manual") {
        showToast("info", update
          ? t("toast.updateFound", { version: nextPendingUpdate.version })
          : t("toast.updateFoundReleasePage", { version: nextPendingUpdate.version }));
      } else {
        rememberPromptedUpdateVersion(nextPendingUpdate.version);
        showToast("info", t("toast.updateDetected", { version: nextPendingUpdate.version }));
      }

      setPendingUpdate(nextPendingUpdate);
    } catch (error) {
      if (source === "manual") {
        showToast("error", getUpdateCheckErrorMessage(error, t));
      }
    } finally {
      if (source === "manual") {
        setUpdateBusy(false);
        setUpdateMessage(null);
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

  function showToast(tone: Toast["tone"], message: string) {
    setToast({ tone, message });
  }

  function changeActiveView(nextView: View) {
    startNavigationTransition(() => setActiveView(nextView));
  }

  function selectRepositoryPath(path: string) {
    startNavigationTransition(() => setSelectedRepoPath(path));
  }

  function selectPullRequest(number: number) {
    if (number === selectedPr) return;
    startNavigationTransition(() => setSelectedPr(number));
  }

  function toggleRepoPanelCollapsed() {
    autoCompactRepoPanelRef.current = false;
    setRepoPanelCollapsed((current) => !current);
  }

  function toggleReviewListCollapsed() {
    autoCompactReviewListRef.current = false;
    setReviewListCollapsed((current) => !current);
  }

  function startPaneResize(kind: "sidebar" | "repositories" | "review", event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = kind === "sidebar"
      ? sidebarWidth
      : kind === "repositories"
        ? repoPanelWidth
        : reviewListWidth;
    document.body.classList.add("resizing-pane");

    const handlePointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      const delta = moveEvent.clientX - startX;
      if (kind === "sidebar") {
        setSidebarWidth(clamp(startWidth + delta, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH));
      } else if (kind === "repositories") {
        setRepoPanelWidth(clamp(startWidth + delta, REPO_PANEL_MIN_WIDTH, REPO_PANEL_MAX_WIDTH));
      } else {
        setReviewListWidth(clamp(startWidth + delta, REVIEW_LIST_MIN_WIDTH, REVIEW_LIST_MAX_WIDTH));
      }
    };

    const stopResize = () => {
      document.body.classList.remove("resizing-pane");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointercancel", stopResize);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize, { once: true });
    window.addEventListener("pointercancel", stopResize, { once: true });
  }

  return (
    <I18nContext.Provider value={i18n}>
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`} style={appShellStyle}>
      <Sidebar
        activeView={activeView}
        onViewChange={changeActiveView}
        repoCount={repositories.length}
        reviewCount={pullRequests.length}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
      />
      <button
        type="button"
        className="pane-resizer app-resizer"
        aria-label={t("layout.adjustSidebar")}
        title={t("layout.dragSidebar")}
        disabled={sidebarCollapsed}
        onPointerDown={(event) => startPaneResize("sidebar", event)}
      />
      <main className="workspace">
        <Topbar
          activeView={activeView}
          scanRoot={scanRoot}
          loading={loading}
          onScanRootChange={setScanRoot}
          onScan={() => void runScan()}
          onPickScanRoot={() => void pickScanRoot()}
          onOpenProjectModal={() => setProjectModalOpen(true)}
        />

        {activeView === "workspaces" && (
          <WorkspacesView
            repositories={visibleRepositories}
            selectedRepo={selectedRepo}
            searchQuery={searchQuery}
            platformSelection={repoPlatformSelection}
            onSearchQueryChange={setSearchQuery}
            onPlatformSelectionChange={setRepoPlatformSelection}
            onSelectRepo={selectRepositoryPath}
            onRefresh={() => void refreshRepository()}
            onOpenWorktreeModal={() => setWorktreeModalOpen(true)}
            onOpenPath={(path, editor) => void call("open_path", { request: { path, editor, custom_command: null } }).catch((error) => showToast("error", getErrorMessage(error, t("error.operationFailed"))))}
            onCopyPath={(path) => void copyPath(path)}
            onRemoveWorktree={(path) => void removeWorktree(selectedRepo, path)}
            pinnedRepositoryIds={pinnedRepositoryIds}
            onTogglePin={toggleRepositoryPin}
            selectedIde={workspaceIde}
            onIdeChange={changeWorkspaceIde}
            giteeEnterprise={Boolean(selectedRepo && repositoryGiteeEnterprise[selectedRepo.common_dir])}
            onGiteeEnterpriseChange={changeRepositoryGiteeEnterprise}
            repoPanelCollapsed={repoPanelCollapsed}
            onToggleRepoPanelCollapsed={toggleRepoPanelCollapsed}
            onStartRepoPanelResize={(event) => startPaneResize("repositories", event)}
            loading={loading}
          />
        )}

        {activeView === "review" && (
          <ReviewView
            repository={selectedRepo}
            pullRequests={visibleReviewPullRequests}
            selectedPullRequest={selectedPullRequest}
            onSelectPullRequest={selectPullRequest}
            queueFilter={reviewQueueFilter}
            queueCounts={reviewQueueCounts}
            searchQuery={reviewSearchQuery}
            platformSelection={reviewPlatformSelection}
            hasMore={currentReviewQueue.hasMore}
            queueLoaded={currentReviewQueue.loaded}
            onQueueFilterChange={changeReviewQueueFilter}
            onSearchQueryChange={setReviewSearchQuery}
            onPlatformSelectionChange={setReviewPlatformSelection}
            loading={reviewLoading}
            filesLoading={reviewFilesLoading}
            error={reviewError}
            tokenConfigured={Boolean(activeProviderToken)}
            listCollapsed={reviewListCollapsed}
            onToggleListCollapsed={toggleReviewListCollapsed}
            onStartListResize={(event) => startPaneResize("review", event)}
            onRefresh={() => void loadReviewQueue(reviewQueueFilter, { force: true })}
            onLoadMore={() => void loadReviewQueue(reviewQueueFilter, { append: true })}
            getPullRequestUrl={(pr) => resolvePullRequestWebUrl(
              selectedRepo,
              pr.webUrl,
              pr.number,
              Boolean(selectedRepo && repositoryGiteeEnterprise[selectedRepo.common_dir]),
            )}
            onOpenUrl={(url) => void call("open_url", { request: { url } }).catch((error) => showToast("error", getErrorMessage(error, t("error.operationFailed"))))}
            onApproveReview={(pr) => void runPullRequestAction("approve_pull_request_review", pr)}
            onResetReview={(pr) => void runPullRequestAction("reset_pull_request_review", pr)}
            onReopenPullRequest={(pr) => void runPullRequestAction("reopen_pull_request", pr)}
            onClosePullRequest={(pr) => void runPullRequestAction("close_pull_request", pr)}
            onMergePullRequest={(pr) => void runPullRequestAction("merge_pull_request", pr)}
            onStartCodeReview={(pr) => void startCodeReview(pr)}
            onLoadFileContent={loadPullRequestFileContent}
            onCreateComment={createPullRequestComment}
          />
        )}

        {activeView === "settings" && (
          <SettingsView
            providerTokens={providerTokens}
            language={language}
            codeReviewCleanupPreference={codeReviewCleanupPreference}
            appVersion={currentAppVersion || (!isTauri ? t("app.developmentPreview") : "")}
            updateBusy={updateBusy}
            updateMessage={updateMessage}
            onLanguageChange={changeLanguage}
            onCodeReviewCleanupPreferenceChange={changeCodeReviewCleanupPreference}
            onConfigureProvider={setProviderModalKind}
            onCheckForUpdates={() => void checkForUpdates("manual")}
          />
        )}
      </main>

      {worktreeModalOpen && selectedRepo && (
        <NewWorktreeModal
          repository={selectedRepo}
          onClose={() => setWorktreeModalOpen(false)}
          onCreated={(repo) => {
            updateRepository(repo);
            setWorktreeModalOpen(false);
            showToast("success", t("toast.workspaceCreated"));
          }}
          onError={(message) => showToast("error", message)}
        />
      )}

      {projectModalOpen && (
        <NewProjectModal
          onClose={() => setProjectModalOpen(false)}
          onCreated={(repo) => {
            updateRepository(repo, { addToScan: true });
            setProjectModalOpen(false);
            showToast("success", t("toast.projectAdded", { name: repo.name }));
          }}
          onError={(message) => showToast("error", message)}
        />
      )}

      {providerModal && providerModalKind && (
        <ProviderTokenModal
          provider={providerModal}
          linked={Boolean(providerTokens[providerModalKind])}
          onClose={() => setProviderModalKind(null)}
          onSave={(token) => saveProviderToken(providerModalKind, token)}
        />
      )}

      {pendingCodeReviewCleanup && (
        <CodeReviewCleanupModal
          pullRequest={pendingCodeReviewCleanup}
          busy={reviewLoading}
          onKeep={() => setPendingCodeReviewCleanup(null)}
          onCleanup={() => void cleanupCodeReviewWorktree(pendingCodeReviewCleanup)}
        />
      )}

      {pendingUpdate && (
        <UpdateModal
          update={pendingUpdate}
          updateBusy={updateBusy}
          onClose={() => void dismissPendingUpdate()}
          onInstall={() => void installPendingUpdate()}
        />
      )}

      {(updateMessage || toast) && (
        <div className="toast-region" aria-live="polite" aria-atomic="true">
          {updateMessage && (
            <div className="toast toast-info update-status-toast">
              {updateBusy ? <Loader2 className="spin" size={16} /> : <Bell size={16} />}
              <span title={updateMessage}>{updateMessage}</span>
            </div>
          )}

          {toast && (
            <div className={`toast toast-${toast.tone}`}>
              {toast.tone === "success" ? <Check size={16} /> : toast.tone === "error" ? <AlertCircle size={16} /> : <Bell size={16} />}
              <span title={toast.message}>{toast.message}</span>
            </div>
          )}
        </div>
      )}
      <FastOverflowTooltip />
    </div>
    </I18nContext.Provider>
  );

  async function removeWorktree(repo: RepositoryInfo | undefined, path: string) {
    if (!repo) return;
    await runWorkspaceOperation(async () => {
      try {
        const refreshed = await call<RepositoryInfo>("remove_worktree", {
          request: { repo_path: repo.root, worktree_path: path, force: false },
        });
        updateRepository(refreshed);
        showToast("success", t("toast.workspaceRemoved"));
      } catch (error) {
        showToast("error", getErrorMessage(error, t("error.operationFailed")));
      }
    });
  }
}

function Sidebar({
  activeView,
  repoCount,
  reviewCount,
  collapsed,
  onViewChange,
  onToggleCollapsed,
}: {
  activeView: View;
  repoCount: number;
  reviewCount: number;
  collapsed: boolean;
  onViewChange: (view: View) => void;
  onToggleCollapsed: () => void;
}) {
  const { t } = useI18n();
  const items: Array<{ view: View; label: string; icon: typeof FolderGit2; badge?: string }> = [
    { view: "workspaces", label: t("nav.workspaces"), icon: FolderGit2, badge: String(repoCount) },
    { view: "review", label: t("nav.codeReview"), icon: GitPullRequest, badge: String(reviewCount) },
  ];

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="brand">
        <div className="brand-mark">
        <GitBranch size={18} />
        </div>
        <div>
          <strong title="WorkTree Desk">WorkTree Desk</strong>
          <span title={t("app.subtitle")}>{t("app.subtitle")}</span>
        </div>
        <button className="icon-button sidebar-collapse-button" onClick={onToggleCollapsed} title={collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}>
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>
      <nav className="nav-list">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.view} className={`nav-item ${activeView === item.view ? "active" : ""}`} onClick={() => onViewChange(item.view)} title={item.label}>
              <Icon size={17} />
              <span>{item.label}</span>
              {item.badge && <small>{item.badge}</small>}
            </button>
          );
        })}
      </nav>
      <div className="sidebar-footer">
        <button type="button" className={`nav-item ${activeView === "settings" ? "active" : ""}`} onClick={() => onViewChange("settings")} title={t("nav.settings")}>
          <Settings size={17} />
          <span>{t("nav.settings")}</span>
        </button>
      </div>
    </aside>
  );
}

function FastOverflowTooltip() {
  const [tooltip, setTooltip] = useState<OverflowTooltipState | null>(null);
  const activeElementRef = useRef<HTMLElement | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    function clearTimer() {
      if (timerRef.current == null) return;
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    function restoreTitle(element: HTMLElement | null) {
      if (!element) return;
      const cachedTitle = element.dataset[FAST_TOOLTIP_TITLE_DATA_KEY];
      if (!cachedTitle) return;
      element.setAttribute("title", cachedTitle);
      delete element.dataset[FAST_TOOLTIP_TITLE_DATA_KEY];
    }

    function hideTooltip() {
      clearTimer();
      restoreTitle(activeElementRef.current);
      activeElementRef.current = null;
      setTooltip(null);
    }

    function showTooltip(element: HTMLElement, text: string) {
      timerRef.current = null;
      activeElementRef.current = element;
      setTooltip({
        text,
        x: pointerRef.current.x + FAST_TOOLTIP_OFFSET,
        y: pointerRef.current.y + FAST_TOOLTIP_OFFSET,
      });
    }

    function scheduleTooltip(element: HTMLElement, text: string) {
      clearTimer();
      timerRef.current = window.setTimeout(
        () => showTooltip(element, text),
        FAST_TOOLTIP_DELAY_MS,
      );
    }

    function handlePointerOver(event: PointerEvent) {
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>("[title]")
        : null;
      if (!target || !target.isConnected) return;
      if (!target.closest(".app-shell")) return;
      if (activeElementRef.current === target) return;

      hideTooltip();

      const title = target.getAttribute("title")?.trim();
      if (!title || !isOverflowTooltipTarget(target)) return;

      pointerRef.current = { x: event.clientX, y: event.clientY };
      target.dataset[FAST_TOOLTIP_TITLE_DATA_KEY] = title;
      target.removeAttribute("title");
      activeElementRef.current = target;
      scheduleTooltip(target, title);
    }

    function handlePointerMove(event: PointerEvent) {
      pointerRef.current = { x: event.clientX, y: event.clientY };
      if (!activeElementRef.current) return;
      setTooltip((current) => current
        ? {
            ...current,
            x: event.clientX + FAST_TOOLTIP_OFFSET,
            y: event.clientY + FAST_TOOLTIP_OFFSET,
          }
        : current);
    }

    function handlePointerOut(event: PointerEvent) {
      const activeElement = activeElementRef.current;
      if (!activeElement) return;
      const relatedTarget = event.relatedTarget;
      if (relatedTarget instanceof Node && activeElement.contains(relatedTarget)) return;
      hideTooltip();
    }

    document.addEventListener("pointerover", handlePointerOver);
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerout", handlePointerOut);
    window.addEventListener("scroll", hideTooltip, true);
    window.addEventListener("resize", hideTooltip);

    return () => {
      document.removeEventListener("pointerover", handlePointerOver);
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerout", handlePointerOut);
      window.removeEventListener("scroll", hideTooltip, true);
      window.removeEventListener("resize", hideTooltip);
      hideTooltip();
    };
  }, []);

  if (!tooltip) return null;

  return (
    <div
      className="fast-overflow-tooltip"
      style={{ left: tooltip.x, top: tooltip.y }}
      role="tooltip"
    >
      {tooltip.text}
    </div>
  );
}

function Topbar({
  activeView,
  scanRoot,
  loading,
  onScanRootChange,
  onScan,
  onPickScanRoot,
  onOpenProjectModal,
}: {
  activeView: View;
  scanRoot: string;
  loading: boolean;
  onScanRootChange: (value: string) => void;
  onScan: () => void;
  onPickScanRoot: () => void;
  onOpenProjectModal: () => void;
}) {
  const { t } = useI18n();
  const title = activeView === "workspaces"
    ? t("topbar.workspacesTitle")
    : activeView === "review"
      ? t("topbar.reviewTitle")
      : t("topbar.settingsTitle");

  return (
    <header className="topbar">
      <div className="title-block">
        <span className="eyebrow">{t("app.eyebrow")}</span>
        <h1>{title}</h1>
      </div>
      {activeView === "workspaces" && (
        <div className="scan-bar">
          <div className="path-input">
            <button type="button" className="inline-icon-button" onClick={onPickScanRoot} title={t("topbar.pickFolder")}>
              <FolderOpen size={16} />
            </button>
            <input value={scanRoot} onChange={(event) => onScanRootChange(event.target.value)} placeholder={t("topbar.scanPlaceholder")} title={scanRoot} />
          </div>
          <button className="icon-button" onClick={onScan} title={t("topbar.scanDirectory")} disabled={loading}>
            {loading ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
          </button>
          <button className="primary-button" onClick={onOpenProjectModal} title={t("topbar.newProject")}>
            <Plus size={16} />
            <span>{t("topbar.newProject")}</span>
          </button>
        </div>
      )}
    </header>
  );
}

function PlatformFilterMenu({
  value,
  includeLocal,
  onChange,
  label,
}: {
  value: GitPlatformSelection;
  includeLocal: boolean;
  onChange: (value: GitPlatformSelection) => void;
  label: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const platformKeys = useMemo(() => getPlatformFilterKeys(includeLocal), [includeLocal]);
  const selectedPlatforms = useMemo(() => normalizePlatformSelection(value, includeLocal), [value, includeLocal]);
  const hasActiveFilter = selectedPlatforms.length > 0;

  useEffect(() => {
    if (!open) return undefined;

    function closeOnOutsidePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      setOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
  }, [open]);

  function togglePlatform(key: GitPlatformKey) {
    const next = new Set(selectedPlatforms);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    onChange(normalizePlatformSelection(platformKeys.filter((platformKey) => next.has(platformKey)), includeLocal));
  }

  return (
    <div className="filter-menu" ref={menuRef}>
      <button
        type="button"
        className={`icon-button filter-menu-trigger ${hasActiveFilter ? "active" : ""}`}
        onClick={() => setOpen((current) => !current)}
        title={label}
        aria-label={label}
        aria-expanded={open}
      >
        <SlidersHorizontal size={15} />
      </button>
      {open && (
        <div className="filter-menu-popover" aria-label={label}>
          <label className="filter-menu-option filter-menu-all">
            <input type="checkbox" checked={!hasActiveFilter} onChange={() => onChange([])} />
            <span>{t("filter.all")}</span>
          </label>
          <div className="filter-menu-separator" />
          {platformKeys.map((key) => {
            const PlatformIcon = getPlatformFilterIcon(key);
            return (
              <label className="filter-menu-option" key={key}>
                <input type="checkbox" checked={selectedPlatforms.includes(key)} onChange={() => togglePlatform(key)} />
                <PlatformIcon size={14} />
                <span>{getPlatformFilterLabel(key, t)}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WorkspacesView({
  repositories,
  selectedRepo,
  searchQuery,
  platformSelection,
  loading,
  onSearchQueryChange,
  onPlatformSelectionChange,
  onSelectRepo,
  onRefresh,
  onOpenWorktreeModal,
  onOpenPath,
  onCopyPath,
  onRemoveWorktree,
  pinnedRepositoryIds,
  onTogglePin,
  selectedIde,
  onIdeChange,
  giteeEnterprise,
  onGiteeEnterpriseChange,
  repoPanelCollapsed,
  onToggleRepoPanelCollapsed,
  onStartRepoPanelResize,
}: {
  repositories: RepositoryInfo[];
  selectedRepo?: RepositoryInfo;
  searchQuery: string;
  platformSelection: GitPlatformSelection;
  loading: boolean;
  onSearchQueryChange: (value: string) => void;
  onPlatformSelectionChange: (value: GitPlatformSelection) => void;
  onSelectRepo: (root: string) => void;
  onRefresh: () => void;
  onOpenWorktreeModal: () => void;
  onOpenPath: (path: string, editor: string) => void;
  onCopyPath: (path: string) => void;
  onRemoveWorktree: (path: string) => void;
  pinnedRepositoryIds: Set<string>;
  onTogglePin: (repo: RepositoryInfo) => void;
  selectedIde: string;
  onIdeChange: (ide: string) => void;
  giteeEnterprise: boolean;
  onGiteeEnterpriseChange: (repo: RepositoryInfo, enabled: boolean) => void;
  repoPanelCollapsed: boolean;
  onToggleRepoPanelCollapsed: () => void;
  onStartRepoPanelResize: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const { t } = useI18n();
  const totalWorktrees = repositories.reduce((sum, repo) => sum + repo.worktrees.length, 0);
  const dirtyCount = repositories.reduce((sum, repo) => sum + repo.worktrees.filter((worktree) => getWorktreeStatus(worktree).dirty).length, 0);
  const repositoryGroups = useMemo(
    () => groupItemsByPlatform(repositories, (repo) => getPlatformFilterKey(repo.provider)),
    [repositories],
  );

  return (
    <section className={`content-grid ${repoPanelCollapsed ? "repo-panel-collapsed" : ""}`}>
      <aside className="repo-panel">
        <div className="panel-toolbar">
          <div className="search-box">
            <Search size={15} />
            <input value={searchQuery} onChange={(event) => onSearchQueryChange(event.target.value)} placeholder={t("repo.searchPlaceholder")} title={searchQuery} />
          </div>
          <PlatformFilterMenu value={platformSelection} includeLocal onChange={onPlatformSelectionChange} label={t("filter.platform")} />
          <button className="icon-button" onClick={onToggleRepoPanelCollapsed} title={t("repo.collapseList")}>
            <PanelLeftClose size={15} />
          </button>
        </div>
        <div className="repo-list">
          {repositoryGroups.length === 0 && (
            <div className="list-empty-message">
              <SlidersHorizontal size={15} />
              <span>{t("repo.noMatches")}</span>
            </div>
          )}
          {repositoryGroups.map((group) => {
            const GroupIcon = getPlatformFilterIcon(group.key);
            return (
              <section className="list-group" key={group.key}>
                <div className="list-group-header">
                  <span>
                    <GroupIcon size={14} />
                    {getPlatformFilterLabel(group.key, t)}
                  </span>
                  <small>{group.items.length}</small>
                </div>
                {group.items.map((repo) => {
            const pinned = pinnedRepositoryIds.has(repo.common_dir);
            const repoSubtitle = repo.provider?.full_name ?? repo.root;
            const repoTooltip = `${repo.name}\n${repoSubtitle}`;
            return (
              <div key={repo.common_dir} className={`repo-row ${selectedRepo?.common_dir === repo.common_dir ? "selected" : ""} ${pinned ? "pinned" : ""}`}>
                <button className="repo-row-main" onClick={() => onSelectRepo(repo.root)} title={repoTooltip}>
                  <FolderGit2 size={18} />
                  <span>
                    <strong title={repo.name}>{repo.name}</strong>
                    <small title={repoSubtitle}>{repoSubtitle}</small>
                  </span>
                  <em>{repo.worktrees.length}</em>
                </button>
                <button className={`repo-pin-button ${pinned ? "active" : ""}`} onClick={() => onTogglePin(repo)} title={pinned ? t("repo.unpin") : t("repo.pin")}>
                  {pinned ? <PinOff size={14} /> : <Pin size={14} />}
                </button>
              </div>
            );
                })}
              </section>
            );
          })}
        </div>
      </aside>
      <button
        type="button"
        className="pane-resizer repo-resizer"
        aria-label={t("repo.adjustList")}
        title={t("repo.dragList")}
        disabled={repoPanelCollapsed}
        onPointerDown={onStartRepoPanelResize}
      />

      <section className="detail-panel">
        {repoPanelCollapsed && (
          <button className="icon-button repo-expand-button" onClick={onToggleRepoPanelCollapsed} title={t("repo.expandList")}>
            <PanelLeftOpen size={15} />
          </button>
        )}
        <div className="summary-strip">
          <Stat label={t("repo.worktrees")} value={totalWorktrees} icon={ListTree} />
          <Stat label={t("repo.dirty")} value={dirtyCount} icon={CircleDot} tone="warn" />
          <div className="stat provider-summary stat-blue">
            <ShieldCheck size={17} />
            <span>{t("repo.provider")}</span>
            <strong title={selectedRepo?.provider?.display_name ?? t("repo.none")}>{selectedRepo?.provider?.display_name ?? t("repo.none")}</strong>
            {selectedRepo?.provider?.kind === "gitee" && (
              <label className="provider-enterprise-toggle" title={t("repo.giteeEnterprise")}>
                <input
                  type="checkbox"
                  checked={giteeEnterprise}
                  onChange={(event) => onGiteeEnterpriseChange(selectedRepo, event.target.checked)}
                />
                <span>{t("repo.giteeEnterprise")}</span>
              </label>
            )}
          </div>
        </div>

        {selectedRepo ? (
          <>
            <div className="repo-header">
              <div>
                <span className="eyebrow" title={selectedRepo.provider?.host ?? t("repo.localRepository")}>{selectedRepo.provider?.host ?? t("repo.localRepository")}</span>
                <h2 title={selectedRepo.name}>{selectedRepo.name}</h2>
                <div className="repo-path-line">
                  <p title={selectedRepo.root}>{selectedRepo.root}</p>
                  <button className="icon-button path-copy-button" onClick={() => onCopyPath(selectedRepo.root)} title={t("repo.copyPath")}>
                    <Copy size={15} />
                  </button>
                </div>
              </div>
              <div className="header-actions">
                <IdeOpenControl
                  value={selectedIde}
                  onChange={onIdeChange}
                  onOpen={() => onOpenPath(selectedRepo.root, selectedIde)}
                  iconOnly={repoPanelCollapsed}
                />
                <button className="ghost-button repo-action-button" onClick={() => onOpenPath(selectedRepo.root, "file-manager")} title={t("repo.openFinder")}>
                  <FolderOpen size={16} />
                  <span className="action-label">{t("repo.finder")}</span>
                </button>
                <button className="primary-button repo-action-button" onClick={onOpenWorktreeModal} title={t("repo.newWorktree")}>
                  <CopyPlus size={16} />
                  <span className="action-label">{t("repo.newWorktree")}</span>
                </button>
              </div>
            </div>

            <div className="worktree-table">
              <div className="table-head">
                <span>{t("repo.table.path")}</span>
                <span>{t("repo.table.branch")}</span>
                <span>{t("repo.table.status")}</span>
                <span>{t("repo.table.sync")}</span>
                <span></span>
              </div>
              {selectedRepo.worktrees.map((worktree) => (
                <WorktreeRow
                  key={worktree.path}
                  worktree={worktree}
                  repoRoot={selectedRepo.root}
                  onOpenPath={onOpenPath}
                  onCopyPath={onCopyPath}
                  ide={selectedIde}
                  onRemove={onRemoveWorktree}
                />
              ))}
            </div>
            <button className="floating-refresh-button" onClick={onRefresh} disabled={loading} title={t("repo.refresh")}>
              {loading ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
            </button>
          </>
        ) : (
          <div className="empty-state">
            <FolderGit2 size={32} />
            <strong>{t("repo.noRepoTitle")}</strong>
            <span>{t("repo.noRepoHint")}</span>
          </div>
        )}
      </section>
    </section>
  );
}

function IdeOpenControl({
  value,
  onChange,
  onOpen,
  iconOnly,
}: {
  value: string;
  onChange: (ide: string) => void;
  onOpen: () => void;
  iconOnly: boolean;
}) {
  const { t } = useI18n();
  const editorLabel = getIdeLabel(value);
  const editorIcon = getIdeIcon(value);
  const [compact, setCompact] = useState(false);
  const controlRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const pickerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (iconOnly) {
      setCompact(false);
      return undefined;
    }

    const control = controlRef.current;
    const measure = measureRef.current;
    if (!control || !measure) return undefined;

    const updateCompact = () => {
      const parent = control.parentElement;
      if (!parent) return;

      const parentStyle = window.getComputedStyle(parent);
      const gap = parseFloat(parentStyle.columnGap || parentStyle.gap || "0") || 0;
      const siblings = Array.from(parent.children).filter((child) => child !== control);
      const siblingWidth = siblings.reduce((sum, child) => (
        sum + (child instanceof HTMLElement ? child.offsetWidth : 0)
      ), 0);
      const availableWidth = parent.clientWidth - siblingWidth - Math.max(parent.children.length - 1, 0) * gap;
      const pickerWidth = pickerRef.current?.offsetWidth ?? 36;
      const requiredWidth = measure.scrollWidth + 16 + 7 + 24 + pickerWidth + 2;
      setCompact(availableWidth < requiredWidth);
    };

    updateCompact();

    const resizeObserver = new ResizeObserver(updateCompact);
    resizeObserver.observe(control);
    resizeObserver.observe(measure);
    if (control.parentElement) resizeObserver.observe(control.parentElement);

    window.addEventListener("resize", updateCompact);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateCompact);
    };
  }, [editorLabel, iconOnly]);

  return (
    <div className={`ide-open-control ${compact && !iconOnly ? "compact" : ""} ${iconOnly ? "icon-only" : ""}`} data-ide={value} ref={controlRef}>
      <button
        type="button"
        className="ide-open-primary"
        onClick={onOpen}
        title={t("repo.openWith", { editor: editorLabel })}
        aria-label={t("repo.openWith", { editor: editorLabel })}
      >
        {editorIcon ? <img className="editor-logo" src={editorIcon} alt="" aria-hidden="true" /> : <Code2 size={16} />}
        {!iconOnly && <span>{editorLabel}</span>}
      </button>
      {!iconOnly && (
        <>
          <span className="ide-open-picker" title={t("repo.selectIde")} ref={pickerRef}>
            <select
              className="ide-open-select"
              value={value}
              onChange={(event) => onChange(event.target.value)}
              aria-label={t("repo.selectIde")}
            >
              {IDE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <ChevronRight className="ide-open-chevron" size={15} />
          </span>
          <span className="ide-open-measure" ref={measureRef} aria-hidden="true">{editorLabel}</span>
        </>
      )}
    </div>
  );
}

function WorktreeRow({
  worktree,
  repoRoot,
  onOpenPath,
  onCopyPath,
  ide,
  onRemove,
}: {
  worktree: WorktreeInfo;
  repoRoot: string;
  onOpenPath: (path: string, editor: string) => void;
  onCopyPath: (path: string) => void;
  ide: string;
  onRemove: (path: string) => void;
}) {
  const { t } = useI18n();
  const branchLabel = worktree.branch ?? (worktree.detached ? t("repo.detached") : t("repo.bare"));
  const status = getWorktreeStatus(worktree);
  const editorIcon = getIdeIcon(ide);
  return (
    <div className="worktree-row">
      <div className="path-cell">
        <FileCode2 size={16} />
        <span title={worktree.path}>{worktree.path}</span>
        <button className="icon-button path-copy-button worktree-path-copy-button" onClick={() => onCopyPath(worktree.path)} title={t("repo.copyWorktreePath")}>
          <Copy size={14} />
        </button>
      </div>
      <div className="branch-cell">
        <GitBranch size={15} />
        <span title={branchLabel}>{branchLabel}</span>
      </div>
      <StatusPill status={status} prunable={worktree.prunable} />
      <div className="sync-cell">
        <span>{status.ahead ? `↑${status.ahead}` : "↑0"}</span>
        <span>{status.behind ? `↓${status.behind}` : "↓0"}</span>
      </div>
      <div className="row-actions">
        <button className="icon-button" title={t("repo.openWith", { editor: getIdeLabel(ide) })} onClick={() => onOpenPath(worktree.path, ide)}>
          {editorIcon ? <img className="editor-logo small" src={editorIcon} alt="" aria-hidden="true" /> : <Code2 size={15} />}
        </button>
        <button className="icon-button" title={t("repo.finder")} onClick={() => onOpenPath(worktree.path, "file-manager")}>
          <FolderOpen size={15} />
        </button>
        <button className="icon-button danger" title={t("repo.remove")} onClick={() => onRemove(worktree.path)} disabled={worktree.path === repoRoot}>
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}

function StatusPill({ status, prunable }: { status: WorktreeStatus; prunable?: string | null }) {
  const { t } = useI18n();
  const summary = !status.dirty && status.summary === "clean" ? t("repo.clean") : status.summary;
  if (prunable) {
    return (
      <div className="status-pill status-warning" title={prunable}>
        <AlertCircle size={14} />
        <span title={prunable}>{t("repo.prunable")}</span>
      </div>
    );
  }

  return (
    <div className={`status-pill ${status.dirty ? "status-dirty" : "status-clean"}`} title={summary}>
      {status.dirty ? <CircleDot size={14} /> : <Check size={14} />}
      <span title={summary}>{summary}</span>
    </div>
  );
}

function Stat({ label, value, icon: Icon, tone = "default" }: { label: string; value: string | number; icon: typeof ListTree; tone?: "default" | "warn" | "blue" }) {
  return (
    <div className={`stat stat-${tone}`}>
      <Icon size={17} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ReviewView({
  repository,
  pullRequests,
  selectedPullRequest,
  onSelectPullRequest,
  queueFilter,
  queueCounts,
  searchQuery,
  platformSelection,
  hasMore,
  queueLoaded,
  onQueueFilterChange,
  onSearchQueryChange,
  onPlatformSelectionChange,
  loading,
  filesLoading,
  error,
  tokenConfigured,
  listCollapsed,
  onToggleListCollapsed,
  onStartListResize,
  onRefresh,
  onLoadMore,
  getPullRequestUrl,
  onOpenUrl,
  onApproveReview,
  onResetReview,
  onReopenPullRequest,
  onClosePullRequest,
  onMergePullRequest,
  onStartCodeReview,
  onLoadFileContent,
  onCreateComment,
}: {
  repository?: RepositoryInfo;
  pullRequests: PullRequestViewModel[];
  selectedPullRequest?: PullRequestViewModel;
  onSelectPullRequest: (number: number) => void;
  queueFilter: ReviewQueueStatus;
  queueCounts: Record<ReviewQueueStatus, string>;
  searchQuery: string;
  platformSelection: GitPlatformSelection;
  hasMore: boolean;
  queueLoaded: boolean;
  onQueueFilterChange: (status: ReviewQueueStatus) => void;
  onSearchQueryChange: (value: string) => void;
  onPlatformSelectionChange: (value: GitPlatformSelection) => void;
  loading: boolean;
  filesLoading: boolean;
  error: string | null;
  tokenConfigured: boolean;
  listCollapsed: boolean;
  onToggleListCollapsed: () => void;
  onStartListResize: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  getPullRequestUrl: (pullRequest: PullRequestViewModel) => string;
  onOpenUrl: (url: string) => void;
  onApproveReview: (pullRequest: PullRequestViewModel) => void;
  onResetReview: (pullRequest: PullRequestViewModel) => void;
  onReopenPullRequest: (pullRequest: PullRequestViewModel) => void;
  onClosePullRequest: (pullRequest: PullRequestViewModel) => void;
  onMergePullRequest: (pullRequest: PullRequestViewModel) => void;
  onStartCodeReview: (pullRequest: PullRequestViewModel) => void;
  onLoadFileContent: (
    pullRequest: PullRequestViewModel,
    file: ReviewFileViewModel,
  ) => Promise<Partial<ReviewFileViewModel> & { message?: string | null }>;
  onCreateComment: (
    pullRequest: PullRequestViewModel,
    comment: PullRequestCommentInput,
  ) => Promise<void>;
}) {
  const { t } = useI18n();
  const [expandedFilePath, setExpandedFilePath] = useState<string | null>(null);
  const [selectedDiffLineKey, setSelectedDiffLineKey] = useState<string | null>(null);
  const [commentingDiffLineKey, setCommentingDiffLineKey] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentTarget, setCommentTarget] = useState<PullRequestCommentInput | null>(null);
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [reviewComments, setReviewComments] = useState<Record<string, string[]>>(loadReviewComments);
  const [collapsedReviewRepositoryKeys, setCollapsedReviewRepositoryKeys] = useState<Set<string>>(() => new Set());
  const [expandedUnchangedFilePaths, setExpandedUnchangedFilePaths] = useState<Set<string>>(() => new Set());
  const [fileContentCache, setFileContentCache] = useState<Record<string, {
    loading: boolean;
    error: string | null;
    content?: Partial<ReviewFileViewModel> & { message?: string | null };
  }>>({});
  const [visibleFileCount, setVisibleFileCount] = useState(REVIEW_INITIAL_FILE_COUNT);
  const [visibleDiffLineCount, setVisibleDiffLineCount] = useState(REVIEW_INITIAL_DIFF_LINES);
  const fileContentRequestKeysRef = useRef(new Set<string>());
  const reviewUrl = selectedPullRequest ? getPullRequestUrl(selectedPullRequest) : repository?.provider?.web_url ?? "";
  const isOpenReview = selectedPullRequest?.queueStatus === "open";
  const canMerge = isOpenReview && selectedPullRequest?.state === "approved" && selectedPullRequest.checks === "passing";
  const reviewGroups = useMemo(
    () => groupPullRequestsByPlatformAndRepository(pullRequests),
    [pullRequests],
  );
  const pullRequestFiles = selectedPullRequest?.files ?? [];
  const visiblePullRequestFiles = useMemo(
    () => pullRequestFiles.slice(0, visibleFileCount),
    [pullRequestFiles, visibleFileCount],
  );
  const hiddenFileCount = Math.max(pullRequestFiles.length - visiblePullRequestFiles.length, 0);

  useEffect(() => {
    setExpandedFilePath(null);
    setSelectedDiffLineKey(null);
    setCommentingDiffLineKey(null);
    setCommentTarget(null);
    setCommentDraft("");
    setExpandedUnchangedFilePaths(new Set());
    setVisibleFileCount(REVIEW_INITIAL_FILE_COUNT);
  }, [selectedPullRequest?.number]);

  useEffect(() => {
    setFileContentCache({});
    fileContentRequestKeysRef.current.clear();
  }, [selectedPullRequest?.number, selectedPullRequest?.repositoryFullName]);

  useEffect(() => {
    setVisibleDiffLineCount(REVIEW_INITIAL_DIFF_LINES);
  }, [expandedFilePath, selectedPullRequest?.number, selectedPullRequest?.repositoryFullName]);

  function switchQueueFilter(nextFilter: ReviewQueueStatus) {
    onQueueFilterChange(nextFilter);
  }

  function toggleUnchangedLines(filePath: string) {
    setExpandedUnchangedFilePaths((current) => {
      const next = new Set(current);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }

  function toggleReviewRepositoryGroup(key: string) {
    setCollapsedReviewRepositoryKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function handleReviewListScroll(event: ReactUIEvent<HTMLElement>) {
    if (!tokenConfigured || loading || !hasMore) return;
    const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
    if (scrollHeight - scrollTop - clientHeight <= 96) {
      onLoadMore();
    }
  }

  function selectDiffLine(file: ReviewFileViewModel, line: string, index: number) {
    if (!selectedPullRequest || selectedPullRequest.queueStatus !== "open" || !isCommentableDiffLine(line)) return;
    setSelectedDiffLineKey(getReviewLineKey(selectedPullRequest.repositoryFullName, selectedPullRequest.number, file.path, index));
    setCommentingDiffLineKey(null);
    setCommentTarget(null);
    setCommentDraft("");
  }

  function startLineComment(
    event: ReactMouseEvent,
    lineKey: string,
    file: ReviewFileViewModel,
    line: string,
    lineIndex: number,
  ) {
    event.stopPropagation();
    setCommentingDiffLineKey(lineKey);
    setCommentTarget({
      filename: file.path,
      lineIndex,
      lineText: line,
      body: "",
    });
    setCommentDraft("");
  }

  async function submitLineComment(event: FormEvent) {
    event.preventDefault();
    if (!selectedPullRequest || !commentingDiffLineKey || !commentTarget || !commentDraft.trim() || commentSubmitting) return;
    const comment = commentDraft.trim();
    setCommentSubmitting(true);
    try {
      await onCreateComment(selectedPullRequest, { ...commentTarget, body: comment });
      setReviewComments((current) => {
        const next = {
          ...current,
          [commentingDiffLineKey]: [...(current[commentingDiffLineKey] ?? []), comment],
        };
        persistReviewComments(next);
        return next;
      });
      setCommentDraft("");
      setCommentingDiffLineKey(null);
      setCommentTarget(null);
    } finally {
      setCommentSubmitting(false);
    }
  }

  function getFileCacheKey(pullRequest: PullRequestViewModel, file: ReviewFileViewModel) {
    return `${pullRequest.repositoryFullName}:${pullRequest.number}:${file.path}`;
  }

  function shouldLoadFileContent(file: ReviewFileViewModel) {
    return Boolean(file.patchMissing) || isPreviewableImagePath(file.path);
  }

  function expandFile(file: ReviewFileViewModel, expanded: boolean) {
    setExpandedFilePath(expanded ? null : file.path);
    setSelectedDiffLineKey(null);
    setCommentingDiffLineKey(null);
    setCommentTarget(null);
    setCommentDraft("");

    if (!selectedPullRequest || expanded || !shouldLoadFileContent(file)) return;

    const cacheKey = getFileCacheKey(selectedPullRequest, file);
    if (
      fileContentRequestKeysRef.current.has(cacheKey)
      || fileContentCache[cacheKey]?.loading
      || fileContentCache[cacheKey]?.content
    ) {
      return;
    }

    fileContentRequestKeysRef.current.add(cacheKey);
    setFileContentCache((current) => ({
      ...current,
      [cacheKey]: { loading: true, error: null },
    }));

    void onLoadFileContent(selectedPullRequest, file)
      .then((content) => {
        setFileContentCache((current) => ({
          ...current,
          [cacheKey]: { loading: false, error: null, content },
        }));
      })
      .catch((error) => {
        setFileContentCache((current) => ({
          ...current,
          [cacheKey]: { loading: false, error: getErrorMessage(error, t("error.operationFailed")) },
        }));
      })
      .finally(() => {
        fileContentRequestKeysRef.current.delete(cacheKey);
      });
  }

  return (
    <section className={`review-layout ${listCollapsed ? "review-list-collapsed" : ""}`}>
      <aside className="review-list">
        <div className="panel-toolbar">
          <div className="search-box">
            <Search size={15} />
            <input value={searchQuery} onChange={(event) => onSearchQueryChange(event.target.value)} placeholder={t("review.searchPlaceholder")} title={searchQuery} />
          </div>
          <PlatformFilterMenu value={platformSelection} includeLocal={false} onChange={onPlatformSelectionChange} label={t("filter.platform")} />
          <button className="icon-button" onClick={onRefresh} disabled={loading || !tokenConfigured} title={t("review.refreshQueue")}>
            {loading ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
          </button>
          <button className="icon-button" onClick={onToggleListCollapsed} title={t("review.collapseList")}>
            <PanelLeftClose size={15} />
          </button>
        </div>
        <div className="review-filter-bar">
          {REVIEW_QUEUE_FILTERS.map((filter) => {
            return (
              <button key={filter.value} className={queueFilter === filter.value ? "active" : ""} onClick={() => switchQueueFilter(filter.value)}>
                <span title={t(filter.labelKey)}>{t(filter.labelKey)}</span>
                <small>{queueCounts[filter.value]}</small>
              </button>
            );
          })}
        </div>
        <div className="review-list-scroll" onScroll={handleReviewListScroll}>
          {error && (
            <div className="review-list-message">
              <AlertCircle size={16} />
              <span title={error}>{error}</span>
            </div>
          )}
          {!error && !repository?.provider && (
            <div className="review-list-message">
              <ShieldCheck size={16} />
              <span>{t("review.noProvider")}</span>
            </div>
          )}
          {!error && repository?.provider && !tokenConfigured && (
            <div className="review-list-message">
              <ShieldCheck size={16} />
              <span title={t("review.tokenRequired", { provider: repository.provider.display_name })}>
                {t("review.tokenRequired", { provider: repository.provider.display_name })}
              </span>
            </div>
          )}
          {!error && !loading && queueLoaded && pullRequests.length === 0 && (searchQuery.trim() || platformSelection.length > 0) && (
            <div className="review-list-message">
              <GitPullRequest size={16} />
              <span>{t("review.noMatches")}</span>
            </div>
          )}
          {!error && tokenConfigured && !loading && queueLoaded && pullRequests.length === 0 && !searchQuery.trim() && platformSelection.length === 0 && (
            <div className="review-list-message">
              <GitPullRequest size={16} />
              <span>{t("review.emptyGroup")}</span>
            </div>
          )}
          {!error && tokenConfigured && loading && pullRequests.length === 0 && (
            <div className="review-list-message">
              <Loader2 className="spin" size={16} />
              <span>{t("review.loading")}</span>
            </div>
          )}
          {reviewGroups.map((group) => {
            const GroupIcon = getPlatformFilterIcon(group.key);
            return (
              <section className="list-group" key={group.key}>
                <div className="list-group-header">
                  <span>
                    <GroupIcon size={14} />
                    {getPlatformFilterLabel(group.key, t)}
                  </span>
                  <small>{group.items.length}</small>
                </div>
                {group.repositories.map((repoGroup) => {
                  const repoGroupKey = `${group.key}:${repoGroup.repositoryFullName}`;
                  const collapsed = collapsedReviewRepositoryKeys.has(repoGroupKey);
                  return (
                  <div className="repo-pr-group" key={repoGroupKey}>
                    <button
                      type="button"
                      className={`repo-pr-group-header ${collapsed ? "collapsed" : ""}`}
                      onClick={() => toggleReviewRepositoryGroup(repoGroupKey)}
                      title={repoGroup.repositoryFullName}
                      aria-expanded={!collapsed}
                    >
                      <span>
                        <ChevronRight className="repo-pr-group-chevron" size={13} />
                        <span title={repoGroup.repositoryFullName}>{repoGroup.repositoryFullName}</span>
                      </span>
                      <small>{repoGroup.items.length}</small>
                    </button>
                    {!collapsed && repoGroup.items.map((pr) => {
                      const reviewMeta = `${getReviewQueueStatusLabel(pr.queueStatus, t)} · ${pr.source} -> ${pr.target}`;
                      const reviewTooltip = `#${pr.number} ${pr.title}\n${pr.repositoryFullName} · ${reviewMeta}`;
                      return (
                        <button key={`${pr.repositoryFullName}-${pr.number}-${pr.queueStatus}`} className={`pr-row ${selectedPullRequest?.number === pr.number && selectedPullRequest.repositoryFullName === pr.repositoryFullName ? "selected" : ""}`} onClick={() => onSelectPullRequest(pr.number)} title={reviewTooltip}>
                          <span className={`state-dot queue-${pr.queueStatus}`} />
                          <strong title={`#${pr.number}`}>#{pr.number}</strong>
                          <span title={pr.title}>{pr.title}</span>
                          <small title={reviewMeta}>{reviewMeta}</small>
                        </button>
                      );
                    })}
                  </div>
                  );
                })}
              </section>
            );
          })}
          {tokenConfigured && hasMore && (
            <button className="review-load-more" onClick={onLoadMore} disabled={loading}>
              {loading ? <Loader2 className="spin" size={15} /> : <ChevronRight size={15} />}
              <span>{t("review.loadMore")}</span>
            </button>
          )}
        </div>
      </aside>
      <button
        type="button"
        className="pane-resizer review-resizer"
        aria-label={t("review.adjustList")}
        title={t("review.dragList")}
        disabled={listCollapsed}
        onPointerDown={onStartListResize}
      />

      <section className="review-detail">
        {listCollapsed && (
          <button className="icon-button review-expand-button" onClick={onToggleListCollapsed} title={t("review.expandList")}>
            <PanelLeftOpen size={15} />
          </button>
        )}
        {selectedPullRequest ? (
          <>
            <div className="repo-header compact">
              <div>
                <span className="eyebrow" title={`${selectedPullRequest.providerName} · ${selectedPullRequest.repositoryFullName}`}>
                  {selectedPullRequest.providerName} · {selectedPullRequest.repositoryFullName}
                </span>
                <h2 title={`#${selectedPullRequest.number} ${selectedPullRequest.title}`}>#{selectedPullRequest.number} {selectedPullRequest.title}</h2>
                <p title={`${selectedPullRequest.author} · ${selectedPullRequest.updatedAt} · ${selectedPullRequest.source} -> ${selectedPullRequest.target}`}>
                  {selectedPullRequest.author} · {selectedPullRequest.updatedAt} · {selectedPullRequest.source} → {selectedPullRequest.target}
                </p>
              </div>
              <div className="header-actions">
                <button className="ghost-button" onClick={() => onOpenUrl(reviewUrl)} disabled={!reviewUrl}>
                  <ExternalLink size={16} />
                  <span>{t("review.openRemote")}</span>
                </button>
                {isOpenReview ? (
                  <button
                    className="primary-button"
                    disabled={loading}
                    title={t("review.mergeCode")}
                    onClick={() => onMergePullRequest(selectedPullRequest)}
                  >
                    <GitMerge size={16} />
                    <span>{t("review.mergeCode")}</span>
                  </button>
                ) : (
                  <button className="ghost-button" disabled title={getTerminalReviewTitle(selectedPullRequest.queueStatus, t)}>
                    {selectedPullRequest.queueStatus === "merged" ? <GitMerge size={16} /> : <X size={16} />}
                    <span>{getTerminalReviewTitle(selectedPullRequest.queueStatus, t)}</span>
                  </button>
                )}
              </div>
            </div>

            <div className="review-split">
              <div className="diff-panel">
                <div className="panel-title">
                  <FileCode2 size={17} />
                  <span>{t("review.changedFiles")}</span>
                  {filesLoading && <Loader2 className="spin" size={15} />}
                  {!isOpenReview && <span className="review-mode-note">{t("review.readonly")}</span>}
                </div>
                {!filesLoading && selectedPullRequest.files.length === 0 && (
                  <div className="review-list-message">
                    <FileCode2 size={16} />
                    <span>{t("review.noFileChanges")}</span>
                  </div>
                )}
                {visiblePullRequestFiles.map((file) => {
              const commentCount = countReviewCommentsForFile(reviewComments, selectedPullRequest.repositoryFullName, selectedPullRequest.number, file.path);
              const expanded = expandedFilePath === file.path;
              const cacheKey = getFileCacheKey(selectedPullRequest, file);
              const cachedFileContent = fileContentCache[cacheKey];
              const resolvedFile = {
                ...file,
                ...cachedFileContent?.content,
                diff: cachedFileContent?.content?.diff ?? file.diff,
                patchText: cachedFileContent?.content?.patchText ?? file.patchText,
              };
              const preview = resolvedFile.imagePreview;
              const diffLines = getReviewFileDiffLines(resolvedFile);
              const unchangedLinesExpanded = expandedUnchangedFilePaths.has(file.path);
              const unchangedLineCount = diffLines.filter(isUnchangedDiffLine).length;
              const visibleDiffItems = buildDiffRenderItems(
                diffLines.slice(0, visibleDiffLineCount),
                !unchangedLinesExpanded,
              );
              const hiddenDiffLineCount = Math.max(diffLines.length - visibleDiffLineCount, 0);
              return (
                <div className="file-review-item" key={file.path}>
                  <button
                    className={`file-row ${expanded ? "expanded" : ""}`}
                    title={file.path}
                    onClick={() => expandFile(file, expanded)}
                  >
                    <ChevronRight className="file-row-chevron" size={15} />
                    <span className={`file-status file-${file.status}`}>{file.status[0].toUpperCase()}</span>
                    <strong title={file.path}>{file.path}</strong>
                    <small>+{file.additions} -{file.deletions}</small>
                    {commentCount > 0 && (
                      <em>
                        <MessageSquare size={13} />
                        {commentCount}
                      </em>
                    )}
                  </button>
                  {expanded && (
                    <div className="file-diff-detail">
                      {cachedFileContent?.loading && (
                        <div className="file-content-state">
                          <Loader2 className="spin" size={15} />
                          <span>{t("review.loadingFileDiff")}</span>
                        </div>
                      )}
                      {cachedFileContent?.error && (
                        <div className="file-content-state file-content-error">
                          <AlertCircle size={15} />
                          <span title={cachedFileContent.error}>{cachedFileContent.error}</span>
                        </div>
                      )}
                      {preview && (
                        <div className="file-preview-panel">
                          <div className="file-preview-meta">
                            <FileCode2 size={15} />
                            <span title={`${preview.mime_type} · ${formatByteSize(preview.size)}`}>
                              {preview.mime_type} · {formatByteSize(preview.size)}
                            </span>
                          </div>
                          <img src={preview.data_url} alt={file.path} title={file.path} />
                        </div>
                      )}
                      {diffLines.length > 0 ? (
                        <>
                        {unchangedLineCount > 0 && (
                          <div className="diff-toolbar">
                            <span title={t("review.unchangedLines", { count: unchangedLineCount })}>
                              {t("review.unchangedLines", { count: unchangedLineCount })}
                            </span>
                            <button
                              type="button"
                              className={`ghost-button diff-context-toggle ${unchangedLinesExpanded ? "expanded" : ""}`}
                              onClick={() => toggleUnchangedLines(file.path)}
                              title={unchangedLinesExpanded ? t("review.hideUnchangedLines") : t("review.showUnchangedLines")}
                            >
                              <ChevronRight size={14} />
                              <span>{unchangedLinesExpanded ? t("review.hideUnchangedLines") : t("review.showUnchangedLines")}</span>
                            </button>
                          </div>
                        )}
                        <div className="diff-code">
                          {visibleDiffItems.map((item) => {
                          if (item.kind === "collapsed") {
                            return (
                              <button
                                type="button"
                                className="diff-collapsed-line"
                                key={`${file.path}-collapsed-${item.startIndex}`}
                                onClick={() => toggleUnchangedLines(file.path)}
                                title={t("review.showUnchangedLines")}
                              >
                                <span>{item.startIndex + 1}</span>
                                <strong>{t("review.hiddenUnchangedLines", { count: item.count })}</strong>
                                <ChevronRight size={14} />
                              </button>
                            );
                          }
                          const { line, originalIndex } = item;
                          const lineKey = getReviewLineKey(selectedPullRequest.repositoryFullName, selectedPullRequest.number, file.path, originalIndex);
                          const lineComments = reviewComments[lineKey] ?? [];
                          const commentable = isOpenReview && isCommentableDiffLine(line);
                          const selected = selectedDiffLineKey === lineKey;
                          const commenting = commentingDiffLineKey === lineKey;
                          return (
                            <div className="diff-line-group" key={lineKey}>
                              <div
                                className={`diff-line ${getDiffLineClass(line)} ${commentable ? "commentable" : ""} ${selected ? "selected" : ""}`}
                                role={commentable ? "button" : undefined}
                                tabIndex={commentable ? 0 : undefined}
                                onClick={() => selectDiffLine(file, line, originalIndex)}
                                onKeyDown={(event) => {
                                  if (commentable && (event.key === "Enter" || event.key === " ")) {
                                    event.preventDefault();
                                    selectDiffLine(file, line, originalIndex);
                                  }
                                }}
                              >
                                <span>{originalIndex + 1}</span>
                                <code title={line}>{line}</code>
                                <div className="diff-line-actions">
                                  {lineComments.length > 0 && (
                                    <em>
                                      <MessageSquare size={13} />
                                      {lineComments.length}
                                    </em>
                                  )}
                                  {commentable && selected && !commenting && (
                                    <button className="ghost-button diff-comment-button" onClick={(event) => startLineComment(event, lineKey, file, line, originalIndex)}>
                                      <MessageSquare size={13} />
                                      <span>{t("review.comment")}</span>
                                    </button>
                                  )}
                                </div>
                              </div>
                              {lineComments.length > 0 && (
                                <div className="line-comment-thread">
                                  {lineComments.map((comment, commentIndex) => (
                                    <div className="comment-item" key={`${lineKey}-${commentIndex}`}>
                                      <strong>{t("review.you")}</strong>
                                      <span title={comment}>{comment}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {commenting && (
                                <form className="comment-form line-comment-form" onSubmit={submitLineComment}>
                                  <textarea value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} placeholder={t("review.commentPlaceholder")} autoFocus />
                                  <div className="comment-form-actions">
                                    <button className="ghost-button" type="button" onClick={() => {
                                      setCommentingDiffLineKey(null);
                                      setCommentTarget(null);
                                    }} disabled={commentSubmitting}>
                                      <X size={15} />
                                      <span>{t("review.cancel")}</span>
                                    </button>
                                    <button className="primary-button" type="submit" disabled={!commentDraft.trim() || commentSubmitting}>
                                      {commentSubmitting ? <Loader2 className="spin" size={15} /> : <Send size={15} />}
                                      <span>{t("review.comment")}</span>
                                    </button>
                                  </div>
                                </form>
                              )}
                            </div>
                          );
                          })}
                          {hiddenDiffLineCount > 0 && (
                            <button
                              type="button"
                              className="review-load-more diff-load-more"
                              onClick={() => setVisibleDiffLineCount((current) => current + REVIEW_DIFF_LINE_STEP)}
                              title={t("review.showMoreDiff", { count: hiddenDiffLineCount })}
                            >
                              <ChevronRight size={15} />
                              <span>{t("review.showMoreDiff", { count: hiddenDiffLineCount })}</span>
                            </button>
                          )}
                        </div>
                        </>
                      ) : !cachedFileContent?.loading && (
                        <div className="file-content-state">
                          {resolvedFile.binary ? <FileCode2 size={15} /> : <AlertCircle size={15} />}
                          <span title={cachedFileContent?.content?.message ?? t("review.noTextDiff")}>
                            {cachedFileContent?.content?.message ?? t("review.noTextDiff")}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
	              );
	                })}
                {hiddenFileCount > 0 && (
                  <button
                    type="button"
                    className="review-load-more file-load-more"
                    onClick={() => setVisibleFileCount((current) => current + REVIEW_FILE_COUNT_STEP)}
                    title={t("review.showMoreFiles", { count: hiddenFileCount })}
                  >
                    <ChevronRight size={15} />
                    <span>{t("review.showMoreFiles", { count: hiddenFileCount })}</span>
                  </button>
                )}
              </div>
              <div className="review-side">
                <div className="approval-box">
                  <BadgeCheck size={24} />
                  <strong title={getReviewStateTitle(selectedPullRequest, t)}>{getReviewStateTitle(selectedPullRequest, t)}</strong>
                  <span title={getReviewStateHint(selectedPullRequest, canMerge, t)}>{getReviewStateHint(selectedPullRequest, canMerge, t)}</span>
                </div>
                <div className="action-stack">
                  {selectedPullRequest.queueStatus === "open" && (
                    <>
                      <button
                        className="primary-button"
                        onClick={() => (
                          selectedPullRequest.state === "approved"
                            ? onResetReview(selectedPullRequest)
                            : onApproveReview(selectedPullRequest)
                        )}
                        disabled={loading || selectedPullRequest.state === "blocked"}
                      >
                        {selectedPullRequest.state === "approved" ? <Minus size={16} /> : <Check size={16} />}
                        <span>{selectedPullRequest.state === "approved" ? t("review.unapprove") : t("review.approve")}</span>
                      </button>
                      <button className="ghost-button" onClick={() => onStartCodeReview(selectedPullRequest)} disabled={loading}>
                        <Code2 size={16} />
                        <span>{t("review.codeReview")}</span>
                      </button>
                      <button className="ghost-button danger-text" onClick={() => onClosePullRequest(selectedPullRequest)} disabled={loading}>
                        <X size={16} />
                        <span>{t("review.closePr")}</span>
                      </button>
                    </>
                  )}
                  {selectedPullRequest.queueStatus === "closed" && (
                    <button className="primary-button" onClick={() => onReopenPullRequest(selectedPullRequest)} disabled={loading}>
                      <RefreshCw size={16} />
                      <span>{t("review.reopen")}</span>
                    </button>
                  )}
                  {(selectedPullRequest.queueStatus === "merged" || selectedPullRequest.queueStatus === "reverted") && (
                    <button className="ghost-button" disabled>
                      {selectedPullRequest.queueStatus === "merged" ? <GitMerge size={16} /> : <X size={16} />}
                      <span>{getTerminalReviewTitle(selectedPullRequest.queueStatus, t)}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="empty-state review-empty-state">
            <GitPullRequest size={32} />
            <strong>{t("review.noSelectedTitle")}</strong>
            <span>{t("review.noSelectedHint")}</span>
          </div>
        )}
      </section>
    </section>
  );
}

function SettingsView({
  providerTokens,
  language,
  codeReviewCleanupPreference,
  appVersion,
  updateBusy,
  updateMessage,
  onLanguageChange,
  onCodeReviewCleanupPreferenceChange,
  onConfigureProvider,
  onCheckForUpdates,
}: {
  providerTokens: Record<ReviewProviderKind, string>;
  language: AppLanguage;
  codeReviewCleanupPreference: CodeReviewCleanupPreference;
  appVersion: string;
  updateBusy: boolean;
  updateMessage: string | null;
  onLanguageChange: (language: AppLanguage) => void;
  onCodeReviewCleanupPreferenceChange: (preference: CodeReviewCleanupPreference) => void;
  onConfigureProvider: (provider: ReviewProviderKind) => void;
  onCheckForUpdates: () => void;
}) {
  const { t } = useI18n();
  const linkedCount = HOSTING_PROVIDERS.filter((provider) => Boolean(providerTokens[provider.kind])).length;
  const versionLabel = appVersion || t("app.developmentPreview");
  const channelLabel = getReleaseChannelLabel(appVersion, t);

  return (
    <section className="settings-page">
      <header className="settings-hero">
        <span className="settings-hero-icon">
          <Settings size={20} />
        </span>
        <div className="settings-hero-copy">
          <span className="eyebrow">{t("app.eyebrow").toUpperCase()}</span>
          <h2 title={t("nav.settings")}>{t("nav.settings")}</h2>
          <p title={t("settings.subtitle")}>{t("settings.subtitle")}</p>
        </div>
        <div className="settings-version-card" title={`${versionLabel} · ${channelLabel}`}>
          <span>{t("settings.version")}</span>
          <strong>{versionLabel}</strong>
          <small>{channelLabel}</small>
        </div>
      </header>

      <div className="settings-grid">
        <section className="settings-panel settings-provider-panel">
          <header className="settings-panel-head">
            <ShieldCheck size={17} />
            <div>
              <strong title={t("settings.hosting")}>{t("settings.hosting")}</strong>
              <small title={t("settings.linkedCount", { linked: linkedCount, total: HOSTING_PROVIDERS.length })}>
                {t("settings.linkedCount", { linked: linkedCount, total: HOSTING_PROVIDERS.length })}
              </small>
            </div>
          </header>
          <div className="settings-provider-list">
            {HOSTING_PROVIDERS.map((provider) => {
              const Icon = provider.icon;
              const linked = Boolean(providerTokens[provider.kind]);
              return (
                <button key={provider.kind} className={`settings-provider-row provider-${provider.tone}`} onClick={() => onConfigureProvider(provider.kind)} title={`${provider.name}\n${provider.host}`}>
                  <span className="provider-config-icon">
                    <Icon size={18} />
                  </span>
                  <span>
                    <strong title={provider.name}>{provider.name}</strong>
                    <small title={provider.host}>{provider.host}</small>
                  </span>
                  {linked ? (
                    <span className="provider-linked-badge">
                      <BadgeCheck size={14} />
                      {t("settings.linked")}
                    </span>
                  ) : (
                    <ChevronRight size={16} />
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <section className="settings-panel">
          <header className="settings-panel-head">
            <SlidersHorizontal size={17} />
            <div>
              <strong title={t("settings.preferences")}>{t("settings.preferences")}</strong>
              <small title={t("settings.preferencesHint")}>{t("settings.preferencesHint")}</small>
            </div>
          </header>

          <div className="settings-row">
            <span className="settings-row-icon">
              <Languages size={16} />
            </span>
            <div>
              <strong title={t("settings.language")}>{t("settings.language")}</strong>
              <small>{getLanguageLabel(language)}</small>
            </div>
            <select className="settings-select" value={language} onChange={(event) => onLanguageChange(event.target.value as AppLanguage)} title={getLanguageLabel(language)}>
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          <div className="settings-row">
            <span className="settings-row-icon">
              <Code2 size={16} />
            </span>
            <div>
              <strong title={t("settings.cleanup")}>{t("settings.cleanup")}</strong>
              <small title={getCodeReviewCleanupDescription(codeReviewCleanupPreference, t)}>
                {getCodeReviewCleanupDescription(codeReviewCleanupPreference, t)}
              </small>
            </div>
            <select
              className="settings-select"
              value={codeReviewCleanupPreference}
              onChange={(event) => onCodeReviewCleanupPreferenceChange(event.target.value as CodeReviewCleanupPreference)}
              title={getCodeReviewCleanupLabel(codeReviewCleanupPreference, t)}
            >
              <option value="auto">{t("settings.cleanup.auto")}</option>
              <option value="ask">{t("settings.cleanup.ask")}</option>
              <option value="keep">{t("settings.cleanup.keep")}</option>
            </select>
          </div>

          <div className="settings-row settings-update-row">
            <span className="settings-row-icon">
              <RefreshCw size={16} />
            </span>
            <div>
              <strong title={t("settings.checkUpdates")}>{t("settings.checkUpdates")}</strong>
              <small title={updateMessage ?? `${channelLabel} · ${versionLabel}`}>
                {updateMessage ?? `${channelLabel} · ${versionLabel}`}
              </small>
            </div>
            <button type="button" className="primary-button" onClick={onCheckForUpdates} disabled={updateBusy}>
              {updateBusy ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
              <span>{t("settings.checkUpdates")}</span>
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}

function ProviderTokenModal({
  provider,
  linked,
  onClose,
  onSave,
}: {
  provider: (typeof HOSTING_PROVIDERS)[number];
  linked: boolean;
  onClose: () => void;
  onSave: (token: string) => void;
}) {
  const [token, setToken] = useState("");
  const Icon = provider.icon;
  const { t } = useI18n();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!token.trim()) return;
    onSave(token);
  }

  return (
    <Modal title={t("modal.providerTitle", { provider: provider.name })} onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <div className={`provider-config provider-${provider.tone} modal-provider-head`}>
          <span className="provider-config-icon">
            <Icon size={18} />
          </span>
          <span>
            <strong title={provider.name}>{provider.name}</strong>
            <small title={provider.host}>{provider.host}</small>
          </span>
          {linked && (
            <span className="provider-linked-badge">
              <BadgeCheck size={14} />
              {t("settings.linked")}
            </span>
          )}
        </div>
        <label>
          <span>{t("modal.token")}</span>
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={linked ? t("modal.tokenPlaceholderUpdate") : t("modal.tokenPlaceholderNew")}
            autoFocus
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>{t("modal.cancel")}</button>
          <button type="submit" className="primary-button" disabled={!token.trim()}>
            <ShieldCheck size={16} />
            <span>{linked ? t("modal.updateLink") : t("modal.confirmLink")}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}

function NewWorktreeModal({
  repository,
  onClose,
  onCreated,
  onError,
}: {
  repository: RepositoryInfo;
  onClose: () => void;
  onCreated: (repo: RepositoryInfo) => void;
  onError: (message: string) => void;
}) {
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [branch, setBranch] = useState(repository.current_branch ?? "main");
  const [worktreePath, setWorktreePath] = useState(`${repository.root}.worktrees/${branch.replace(/[/:]/g, "-")}`);
  const [createBranch, setCreateBranch] = useState(true);
  const [loading, setLoading] = useState(false);
  const { t } = useI18n();
  const branchMatchesKnownRef = useMemo(
    () => branches.some((item) => item.name === branch.trim()),
    [branches, branch],
  );

  useEffect(() => {
    void call<BranchInfo[]>("list_branches", { repoPath: repository.root })
      .then(setBranches)
      .catch(() => setBranches([]));
  }, [repository.root]);

  useEffect(() => {
    if (branchMatchesKnownRef) {
      setCreateBranch(false);
    }
  }, [branchMatchesKnownRef]);

  function updateBranch(value: string) {
    setBranch(value);
    setWorktreePath(`${repository.root}.worktrees/${value.replace(/[/:]/g, "-")}`);
    setCreateBranch(!branches.some((item) => item.name === value.trim()));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      const repo = await call<RepositoryInfo>("add_worktree", {
        request: {
          repo_path: repository.root,
          worktree_path: worktreePath,
          branch,
          create_branch: createBranch,
        },
      });
      onCreated(repo);
    } catch (error) {
      onError(getErrorMessage(error, t("error.operationFailed")));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title={t("modal.newWorktree")} onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <label>
          <span>{t("modal.repository")}</span>
          <div className="readonly-field" title={repository.name}>{repository.name}</div>
        </label>
        <label>
          <span>{t("modal.branch")}</span>
          <input value={branch} onChange={(event) => updateBranch(event.target.value)} list="branch-options" title={branch} />
          <datalist id="branch-options">
            {branches.map((item) => (
              <option key={item.name} value={item.name} />
            ))}
          </datalist>
        </label>
        <label>
          <span>{t("modal.path")}</span>
          <input value={worktreePath} onChange={(event) => setWorktreePath(event.target.value)} title={worktreePath} />
        </label>
        <label className="toggle-line">
          <input
            type="checkbox"
            checked={createBranch}
            disabled={branchMatchesKnownRef}
            onChange={(event) => setCreateBranch(event.target.checked)}
          />
          <span>{t("modal.createBranch")}</span>
        </label>
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>{t("modal.cancel")}</button>
          <button type="submit" className="primary-button" disabled={loading}>
            {loading ? <Loader2 className="spin" size={16} /> : <CopyPlus size={16} />}
            <span>{t("modal.create")}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}

function NewProjectModal({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void;
  onCreated: (repo: RepositoryInfo) => void;
  onError: (message: string) => void;
}) {
  const [mode, setMode] = useState<ProjectMode>("local");
  const [localPath, setLocalPath] = useState("/Users/joe/Documents/WorkFlowStudio");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [parentDir, setParentDir] = useState("/Users/joe/Documents/Work");
  const [directoryName, setDirectoryName] = useState("");
  const [loading, setLoading] = useState(false);
  const { t } = useI18n();

  async function chooseDirectory(target: "local" | "parent") {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") {
        if (target === "local") setLocalPath(selected);
        else setParentDir(selected);
      }
    } catch {
      onError(t("error.directoryUnavailable"));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      const repo = mode === "local"
        ? await call<RepositoryInfo>("inspect_path", { path: localPath })
        : await call<RepositoryInfo>("clone_repository", {
            request: {
              remote_url: remoteUrl,
              parent_dir: parentDir,
              directory_name: directoryName || null,
            },
          });
      onCreated(repo);
    } catch (error) {
      onError(getErrorMessage(error, t("error.operationFailed")));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title={t("modal.newProject")} onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <div className="segmented">
          <button type="button" className={mode === "local" ? "active" : ""} onClick={() => setMode("local")}>{t("modal.local")}</button>
          <button type="button" className={mode === "remote" ? "active" : ""} onClick={() => setMode("remote")}>{t("modal.remote")}</button>
        </div>
        {mode === "local" ? (
          <label>
            <span>{t("modal.localRepo")}</span>
            <div className="input-with-button">
              <input value={localPath} onChange={(event) => setLocalPath(event.target.value)} title={localPath} />
              <button type="button" className="icon-button" onClick={() => void chooseDirectory("local")} title={t("modal.chooseDirectory")}>
                <FolderOpen size={15} />
              </button>
            </div>
          </label>
        ) : (
          <>
            <label>
              <span>{t("modal.remoteUrl")}</span>
              <input value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="https://github.com/org/repo.git" title={remoteUrl} />
            </label>
            <label>
              <span>{t("modal.targetDir")}</span>
              <div className="input-with-button">
                <input value={parentDir} onChange={(event) => setParentDir(event.target.value)} title={parentDir} />
                <button type="button" className="icon-button" onClick={() => void chooseDirectory("parent")} title={t("modal.chooseDirectory")}>
                  <FolderOpen size={15} />
                </button>
              </div>
            </label>
            <label>
              <span>{t("modal.dirName")}</span>
              <input value={directoryName} onChange={(event) => setDirectoryName(event.target.value)} placeholder={t("modal.autoInfer")} title={directoryName} />
            </label>
          </>
        )}
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>{t("modal.cancel")}</button>
          <button type="submit" className="primary-button" disabled={loading}>
            {loading ? <Loader2 className="spin" size={16} /> : mode === "local" ? <FolderGit2 size={16} /> : <ArrowRight size={16} />}
            <span>{mode === "local" ? t("modal.add") : t("modal.clone")}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CodeReviewCleanupModal({
  pullRequest,
  busy,
  onKeep,
  onCleanup,
}: {
  pullRequest: PullRequestViewModel;
  busy: boolean;
  onKeep: () => void;
  onCleanup: () => void;
}) {
  const { t } = useI18n();
  return (
    <Modal title={t("modal.cleanupCodeReview")} onClose={onKeep}>
      <div className="modal-form">
        <div className="settings-hint">
          <Trash2 size={16} />
          <span title={`#${pullRequest.number} ${pullRequest.title}`}>
            #{pullRequest.number} {pullRequest.title}
          </span>
        </div>
        <p title={t("modal.cleanupQuestion")}>
          {t("modal.cleanupQuestion")}
        </p>
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onKeep} disabled={busy}>{t("modal.keep")}</button>
          <button type="button" className="primary-button" onClick={onCleanup} disabled={busy}>
            {busy ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
            <span>{t("modal.deleteTemp")}</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}

function UpdateModal({
  update,
  updateBusy,
  onClose,
  onInstall,
}: {
  update: PendingUpdate;
  updateBusy: boolean;
  onClose: () => void;
  onInstall: () => void;
}) {
  const { t } = useI18n();
  return (
    <Modal title={t("modal.updateFound")} onClose={onClose}>
      <div className="modal-form">
        <div className="update-summary">
          <span className="update-summary-icon">
            <RefreshCw size={18} />
          </span>
          <div>
            <strong title={t("modal.detectedVersion", { version: update.version })}>{t("modal.detectedVersion", { version: update.version })}</strong>
            <small title={t("modal.currentVersion", { version: update.currentVersion })}>{t("modal.currentVersion", { version: update.currentVersion })}</small>
          </div>
        </div>
        {update.body ? (
          <div className="update-notes" title={update.body}>
            {update.body}
          </div>
        ) : (
          <div className="settings-hint">
            <Bell size={16} />
            <span>{t("modal.noUpdateNotes")}</span>
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose} disabled={updateBusy}>{t("modal.later")}</button>
          <button type="button" className="primary-button" onClick={onInstall} disabled={updateBusy}>
            {updateBusy ? <Loader2 className="spin" size={16} /> : update.installable ? <RefreshCw size={16} /> : <ExternalLink size={16} />}
            <span>{update.installable ? t("modal.installRestart") : t("modal.openReleasePage")}</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <div className="modal-backdrop">
      <section className="modal">
        <header className="modal-header">
          <h2 title={title}>{title}</h2>
          <button className="icon-button" onClick={onClose} title={t("modal.close")}>
            <X size={16} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function createEmptyReviewQueueState(): ReviewQueueState {
  return {
    items: [],
    page: 0,
    hasMore: false,
    loaded: false,
  };
}

function createEmptyReviewQueues(): Record<ReviewQueueStatus, ReviewQueueState> {
  return REVIEW_QUEUE_FILTERS.reduce((queues, filter) => {
    queues[filter.value] = createEmptyReviewQueueState();
    return queues;
  }, {} as Record<ReviewQueueStatus, ReviewQueueState>);
}

function createDemoReviewQueues(): Record<ReviewQueueStatus, ReviewQueueState> {
  const queues = createEmptyReviewQueues();
  for (const filter of REVIEW_QUEUE_FILTERS) {
    const items = demoPullRequests.filter((pullRequest) => pullRequest.queueStatus === filter.value);
    queues[filter.value] = {
      items,
      page: 1,
      hasMore: false,
      loaded: true,
    };
  }
  return queues;
}

function loadCachedScanResult(): ScanResult | null {
  try {
    const raw = window.localStorage.getItem(SCAN_RESULT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ScanResult>;
    if (!parsed || typeof parsed.root !== "string" || !Array.isArray(parsed.repositories)) return null;
    return {
      root: parsed.root,
      repositories: parsed.repositories.map(normalizeRepository),
    };
  } catch {
    return null;
  }
}

function persistCachedScanResult(result: ScanResult) {
  try {
    window.localStorage.setItem(SCAN_RESULT_STORAGE_KEY, JSON.stringify(result));
  } catch {
    // The app still works with in-memory repository state if storage is unavailable.
  }
}

function normalizeRepository(repository: RepositoryInfo): RepositoryInfo {
  const provider = repository.provider ?? repository.gitee ?? null;
  return {
    ...repository,
    provider,
    worktrees: Array.isArray(repository.worktrees)
      ? repository.worktrees.map((worktree) => ({
          ...worktree,
          status: getWorktreeStatus(worktree),
        }))
      : [],
  };
}

function loadPinnedRepositories(): RepositoryInfo[] {
  try {
    const raw = window.localStorage.getItem(PINNED_REPOSITORIES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? uniqueRepositories((parsed as RepositoryInfo[]).map(normalizeRepository)) : [];
  } catch {
    return [];
  }
}

function persistPinnedRepositories(repositories: RepositoryInfo[]) {
  try {
    window.localStorage.setItem(PINNED_REPOSITORIES_STORAGE_KEY, JSON.stringify(repositories));
  } catch {
    // localStorage can be unavailable in constrained WebViews; pinning still works for this session.
  }
}

function loadWorkspaceIdePreference(): string {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_IDE_STORAGE_KEY);
    return isIdeValue(raw) ? raw : "cursor";
  } catch {
    return "cursor";
  }
}

function persistWorkspaceIdePreference(ide: string) {
  try {
    window.localStorage.setItem(WORKSPACE_IDE_STORAGE_KEY, ide);
  } catch {
    // IDE preference remains usable for the current session when persistence is unavailable.
  }
}

function loadRepositoryGiteeEnterprisePreferences(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(REPOSITORY_GITEE_ENTERPRISE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, boolean>
      : {};
  } catch {
    return {};
  }
}

function persistRepositoryGiteeEnterprisePreferences(preferences: Record<string, boolean>) {
  try {
    window.localStorage.setItem(REPOSITORY_GITEE_ENTERPRISE_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Gitee enterprise preferences remain usable for the current session when persistence is unavailable.
  }
}

function loadProviderTokenPreferences(): Record<ReviewProviderKind, string> {
  try {
    const raw = window.localStorage.getItem(PROVIDER_TOKENS_STORAGE_KEY);
    if (!raw) return {} as Record<ReviewProviderKind, string>;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {} as Record<ReviewProviderKind, string>;
    return HOSTING_PROVIDERS.reduce((tokens, provider) => {
      const token = (parsed as Record<string, unknown>)[provider.kind];
      if (typeof token === "string" && token.trim()) {
        tokens[provider.kind] = token;
      }
      return tokens;
    }, {} as Record<ReviewProviderKind, string>);
  } catch {
    return {} as Record<ReviewProviderKind, string>;
  }
}

function persistProviderTokenPreferences(preferences: Record<ReviewProviderKind, string>) {
  try {
    window.localStorage.setItem(PROVIDER_TOKENS_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Provider links remain available for the current session when persistence is unavailable.
  }
}

function loadWorkspaceFilterPreferences(): WorkspaceFilterPreferences {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_FILTERS_STORAGE_KEY);
    if (!raw) return createDefaultWorkspaceFilterPreferences();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return createDefaultWorkspaceFilterPreferences();

    return {
      searchQuery: getStoredFilterQuery((parsed as Record<string, unknown>).searchQuery),
      platformSelection: getStoredPlatformSelection((parsed as Record<string, unknown>).platformSelection, true),
    };
  } catch {
    return createDefaultWorkspaceFilterPreferences();
  }
}

function persistWorkspaceFilterPreferences(preferences: WorkspaceFilterPreferences) {
  try {
    window.localStorage.setItem(WORKSPACE_FILTERS_STORAGE_KEY, JSON.stringify({
      searchQuery: preferences.searchQuery,
      platformSelection: normalizePlatformSelection(preferences.platformSelection, true),
    }));
  } catch {
    // Workspace filters remain available for the current session when persistence is unavailable.
  }
}

function loadReviewFilterPreferences(): ReviewFilterPreferences {
  try {
    const raw = window.localStorage.getItem(REVIEW_FILTERS_STORAGE_KEY);
    if (!raw) return createDefaultReviewFilterPreferences();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return createDefaultReviewFilterPreferences();

    const values = parsed as Record<string, unknown>;
    return {
      searchQuery: getStoredFilterQuery(values.searchQuery),
      platformSelection: getStoredPlatformSelection(values.platformSelection, false),
      queueFilter: isReviewQueueStatus(values.queueFilter) ? values.queueFilter : "open",
    };
  } catch {
    return createDefaultReviewFilterPreferences();
  }
}

function persistReviewFilterPreferences(preferences: ReviewFilterPreferences) {
  try {
    window.localStorage.setItem(REVIEW_FILTERS_STORAGE_KEY, JSON.stringify({
      searchQuery: preferences.searchQuery,
      platformSelection: normalizePlatformSelection(preferences.platformSelection, false),
      queueFilter: preferences.queueFilter,
    }));
  } catch {
    // Review filters remain available for the current session when persistence is unavailable.
  }
}

function createDefaultWorkspaceFilterPreferences(): WorkspaceFilterPreferences {
  return {
    searchQuery: "",
    platformSelection: [],
  };
}

function createDefaultReviewFilterPreferences(): ReviewFilterPreferences {
  return {
    ...createDefaultWorkspaceFilterPreferences(),
    queueFilter: "open",
  };
}

function getStoredFilterQuery(value: unknown) {
  return typeof value === "string" ? value : "";
}

function getStoredPlatformSelection(value: unknown, includeLocal: boolean): GitPlatformSelection {
  return Array.isArray(value)
    ? normalizePlatformSelection(value.filter(isGitPlatformKey), includeLocal)
    : [];
}

function loadLanguagePreference(): AppLanguage {
  try {
    const raw = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isAppLanguage(raw) ? raw : "zh-CN";
  } catch {
    return "zh-CN";
  }
}

function persistLanguagePreference(language: AppLanguage) {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Language changes still apply to the current session when persistence is unavailable.
  }
}

function loadCodeReviewCleanupPreference(): CodeReviewCleanupPreference {
  try {
    const raw = window.localStorage.getItem(CODE_REVIEW_CLEANUP_STORAGE_KEY);
    return isCodeReviewCleanupPreference(raw) ? raw : "ask";
  } catch {
    return "ask";
  }
}

function persistCodeReviewCleanupPreference(preference: CodeReviewCleanupPreference) {
  try {
    window.localStorage.setItem(CODE_REVIEW_CLEANUP_STORAGE_KEY, preference);
  } catch {
    // The selected cleanup behavior still applies for the current session.
  }
}

function loadReviewComments(): Record<string, string[]> {
  try {
    const raw = window.localStorage.getItem(REVIEW_COMMENTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    return Object.entries(parsed).reduce((comments, [key, value]) => {
      if (typeof key === "string" && Array.isArray(value)) {
        comments[key] = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
      }
      return comments;
    }, {} as Record<string, string[]>);
  } catch {
    return {};
  }
}

function persistReviewComments(comments: Record<string, string[]>) {
  try {
    window.localStorage.setItem(REVIEW_COMMENTS_STORAGE_KEY, JSON.stringify(comments));
  } catch {
    // Comments remain available for the current session when storage is unavailable.
  }
}

function isPullRequestReviewState(value: unknown): value is PullRequestViewModel["state"] {
  return value === "open" || value === "approved" || value === "blocked";
}

function loadReviewStateOverrides(): Record<string, PullRequestViewModel["state"]> {
  try {
    const raw = window.localStorage.getItem(REVIEW_STATE_OVERRIDES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    return Object.entries(parsed).reduce((states, [key, value]) => {
      if (typeof key === "string" && isPullRequestReviewState(value)) {
        states[key] = value;
      }
      return states;
    }, {} as Record<string, PullRequestViewModel["state"]>);
  } catch {
    return {};
  }
}

function persistReviewStateOverrides(states: Record<string, PullRequestViewModel["state"]>) {
  try {
    window.localStorage.setItem(REVIEW_STATE_OVERRIDES_STORAGE_KEY, JSON.stringify(states));
  } catch {
    // Review state overrides remain available for the current session when storage is unavailable.
  }
}

function loadPromptedUpdateVersion() {
  try {
    return window.localStorage.getItem(UPDATE_PROMPTED_VERSION_KEY) || "";
  } catch {
    return "";
  }
}

function savePromptedUpdateVersion(version: string) {
  try {
    if (version) {
      window.localStorage.setItem(UPDATE_PROMPTED_VERSION_KEY, version);
    } else {
      window.localStorage.removeItem(UPDATE_PROMPTED_VERSION_KEY);
    }
  } catch {
    // Update prompts can still be shown if persistence is unavailable.
  }
}

function isAppLanguage(value: unknown): value is AppLanguage {
  return LANGUAGE_OPTIONS.some((option) => option.value === value);
}

function isGitPlatformKey(value: unknown): value is GitPlatformKey {
  return PLATFORM_GROUP_ORDER.includes(value as GitPlatformKey);
}

function isReviewQueueStatus(value: unknown): value is ReviewQueueStatus {
  return REVIEW_QUEUE_FILTERS.some((filter) => filter.value === value);
}

function isCodeReviewCleanupPreference(value: unknown): value is CodeReviewCleanupPreference {
  return value === "auto" || value === "ask" || value === "keep";
}

function isOverflowTooltipTarget(element: HTMLElement) {
  if (isElementVisiblyOverflowing(element)) return true;

  const overflowCandidates = element.querySelectorAll<HTMLElement>("span, strong, small, p, h1, h2, h3, code, em");
  for (const candidate of overflowCandidates) {
    if (isElementVisiblyOverflowing(candidate)) return true;
  }

  return false;
}

function isElementVisiblyOverflowing(element: HTMLElement) {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.scrollWidth > element.clientWidth + 1;
  }

  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") return false;
  return element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1;
}

function isIdeValue(value: unknown): value is string {
  return typeof value === "string" && IDE_OPTIONS.some((ide) => ide.value === value);
}

function getIdeLabel(value: string) {
  return IDE_OPTIONS.find((ide) => ide.value === value)?.label ?? value;
}

function getIdeIcon(value: string) {
  return IDE_OPTIONS.find((ide) => ide.value === value)?.icon ?? null;
}

function getHostingProvider(kind: ReviewProviderKind) {
  return HOSTING_PROVIDERS.find((provider) => provider.kind === kind) ?? HOSTING_PROVIDERS[0];
}

function getPlatformFilterKeys(includeLocal: boolean) {
  return includeLocal
    ? PLATFORM_GROUP_ORDER
    : PLATFORM_GROUP_ORDER.filter((key) => key !== "local");
}

function normalizePlatformSelection(selection: GitPlatformSelection, includeLocal: boolean): GitPlatformSelection {
  const allowedKeys = getPlatformFilterKeys(includeLocal);
  const seen = new Set<GitPlatformKey>();
  const normalized = selection.filter((key) => {
    if (!allowedKeys.includes(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (normalized.length === 0 || normalized.length === allowedKeys.length) {
    return [];
  }

  return normalized;
}

function matchesPlatformSelection(platformKey: GitPlatformKey, selection: GitPlatformSelection) {
  return selection.length === 0 || selection.includes(platformKey);
}

function getPlatformFilterKey(provider?: ReviewProviderInfo | null): GitPlatformKey {
  return provider?.kind ?? "local";
}

function getPlatformFilterLabel(key: GitPlatformKey, t: I18nRuntime["t"]) {
  return key === "local" ? t("repo.localRepository") : getHostingProvider(key).name;
}

function getPlatformFilterIcon(key: GitPlatformKey) {
  return key === "local" ? FolderGit2 : getHostingProvider(key).icon;
}

function groupItemsByPlatform<T>(items: T[], getPlatformKey: (item: T) => GitPlatformKey) {
  const buckets = items.reduce((groups, item) => {
    const key = getPlatformKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
    return groups;
  }, new Map<GitPlatformKey, T[]>());

  return PLATFORM_GROUP_ORDER
    .map((key) => ({ key, items: buckets.get(key) ?? [] }))
    .filter((group) => group.items.length > 0);
}

function groupPullRequestsByPlatformAndRepository(items: PullRequestViewModel[]) {
  return groupItemsByPlatform(items, (pullRequest) => pullRequest.providerKind)
    .map((group) => {
      const repositoryBuckets = group.items.reduce((groups, item) => {
        const key = item.repositoryFullName;
        groups.set(key, [...(groups.get(key) ?? []), item]);
        return groups;
      }, new Map<string, PullRequestViewModel[]>());

      return {
        ...group,
        repositories: Array.from(repositoryBuckets.entries()).map(([repositoryFullName, repoItems]) => ({
          repositoryFullName,
          items: repoItems,
        })),
      };
    });
}

function getLanguageLabel(value: AppLanguage) {
  return LANGUAGE_OPTIONS.find((language) => language.value === value)?.label ?? value;
}

function getCodeReviewCleanupLabel(value: CodeReviewCleanupPreference, t: I18nRuntime["t"]) {
  if (value === "auto") return t("settings.cleanup.auto");
  if (value === "keep") return t("settings.cleanup.keep");
  return t("settings.cleanup.ask");
}

function getCodeReviewCleanupDescription(value: CodeReviewCleanupPreference, t: I18nRuntime["t"]) {
  if (value === "auto") return t("settings.cleanup.autoDesc");
  if (value === "keep") return t("settings.cleanup.keepDesc");
  return t("settings.cleanup.askDesc");
}

function getReleaseChannelLabel(version: string, t: I18nRuntime["t"]) {
  if (!version || version === t("app.developmentPreview")) return t("settings.channel.dev");
  if (version === t("app.unknownVersion")) return t("settings.channel.unknown");
  return version.includes("-preview.") ? t("settings.channel.preview") : t("settings.channel.stable");
}

function getWorktreeStatus(worktree: WorktreeInfo): WorktreeStatus {
  return worktree.status ?? {
    dirty: false,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    ahead: 0,
    behind: 0,
    summary: "clean",
  };
}

function getReviewQueueStatusLabel(status: ReviewQueueStatus, t: I18nRuntime["t"]) {
  const labelKey = REVIEW_QUEUE_FILTERS.find((filter) => filter.value === status)?.labelKey;
  return labelKey ? t(labelKey) : status;
}

function getTerminalReviewTitle(status: ReviewQueueStatus, t: I18nRuntime["t"]) {
  if (status === "closed") return t("review.terminal.closed");
  if (status === "merged") return t("review.terminal.merged");
  if (status === "reverted") return t("review.terminal.reverted");
  return t("review.terminal.open");
}

function getReviewStateTitle(pullRequest: PullRequestViewModel, t: I18nRuntime["t"]) {
  if (pullRequest.queueStatus !== "open") return getTerminalReviewTitle(pullRequest.queueStatus, t);
  if (pullRequest.checks === "passing") return t("review.state.passing");
  if (pullRequest.checks === "pending") return t("review.state.pending");
  return t("review.state.failed");
}

function getReviewStateHint(pullRequest: PullRequestViewModel, canMerge: boolean, t: I18nRuntime["t"]) {
  if (pullRequest.queueStatus === "closed") return t("review.hint.closed");
  if (pullRequest.queueStatus === "merged") return t("review.hint.merged");
  if (pullRequest.queueStatus === "reverted") return t("review.hint.reverted");
  return canMerge ? t("review.hint.canMerge") : t("review.hint.waiting");
}

function resolvePullRequestWebUrl(
  repository: RepositoryInfo | undefined,
  fallbackUrl: string,
  number: number,
  giteeEnterprise: boolean,
) {
  const provider = repository?.provider;
  if (!provider || provider.kind !== "gitee") return fallbackUrl;

  const repoUrl = buildGiteeRepoWebUrl(provider, giteeEnterprise);
  return `${repoUrl}/pulls/${number}`;
}

function buildGiteeRepoWebUrl(provider: ReviewProviderInfo, giteeEnterprise: boolean) {
  if (giteeEnterprise) {
    const tenant = provider.owner.split("/")[0] || provider.owner;
    if (tenant) {
      return `https://e.gitee.com/${tenant}/repos/${provider.full_name}`;
    }
  }

  return `https://gitee.com/${provider.full_name}`;
}

function mapPullRequest(
  repository: RepositoryInfo,
  pullRequest: PullRequestInfo,
  queueStatus: ReviewQueueStatus,
  files: PullRequestChangedFileInfo[] = [],
): PullRequestViewModel {
  const reviewStatus = pullRequest.review_status?.toLowerCase() ?? "";
  const reviewState: PullRequestViewModel["state"] = pullRequest.review_action_allowed === false
    ? "blocked"
    : reviewStatus.includes("approved") || reviewStatus.includes("pass") || reviewStatus.includes("同意")
      ? "approved"
      : "open";
  const checks = mapCheckStatus(pullRequest.test_status);

  return {
    number: pullRequest.number,
    title: pullRequest.title,
    author: pullRequest.author || "unknown",
    state: reviewState,
    queueStatus,
    repositoryName: repository.name,
    repositoryFullName: repository.provider?.full_name ?? repository.name,
    repositoryUrl: repository.provider?.web_url ?? repository.root,
    providerName: repository.provider?.display_name ?? "Git",
    providerKind: repository.provider?.kind ?? "gitee",
    webUrl: pullRequest.web_url,
    source: pullRequest.source_branch ?? pullRequest.source_repo ?? "unknown",
    target: pullRequest.target_branch ?? pullRequest.target_repo ?? "unknown",
    updatedAt: formatReviewTime(pullRequest.updated_at ?? pullRequest.created_at),
    checks,
    files: files.map(mapChangedFile),
  };
}

function mapChangedFile(file: PullRequestChangedFileInfo): ReviewFileViewModel {
  const status = normalizeFileStatus(file.status);
  const patch = file.patch?.trim() ?? "";

  return {
    path: file.filename,
    status,
    additions: file.additions ?? 0,
    deletions: file.deletions ?? 0,
    diff: [],
    patchText: patch ? file.patch ?? "" : "",
    patchMissing: !patch,
    rawUrl: file.raw_url,
    binary: false,
  };
}

function mapPullRequestFileContent(
  content: PullRequestFileContentInfo,
): Partial<ReviewFileViewModel> & { message?: string | null } {
  const patch = content.patch?.trim() ?? "";
  return {
    diff: [],
    patchText: patch ? content.patch ?? "" : "",
    patchMissing: !patch,
    imagePreview: content.image_preview ?? null,
    binary: Boolean(content.binary),
    message: content.message ?? null,
  };
}

function getReviewFileDiffLines(file: Pick<ReviewFileViewModel, "diff" | "patchText">) {
  if (file.diff.length > 0) return file.diff;
  if (!file.patchText?.trim()) return [];
  return file.patchText.split(/\r?\n/);
}

function normalizeFileStatus(status?: string | null): ReviewFileViewModel["status"] {
  const normalized = status?.toLowerCase() ?? "";
  if (normalized.includes("add") || normalized === "new") return "added";
  if (normalized.includes("delete") || normalized.includes("remove")) return "deleted";
  return "modified";
}

function mapCheckStatus(status?: string | null): PullRequestViewModel["checks"] {
  const normalized = status?.toLowerCase() ?? "";
  if (normalized.includes("fail") || normalized.includes("error") || normalized.includes("reject")) return "failed";
  if (normalized.includes("pass") || normalized.includes("success") || normalized.includes("approved")) return "passing";
  return "pending";
}

function formatReviewTime(value?: string | null) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatByteSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = unitIndex === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function getReviewLineKey(repositoryFullName: string, prNumber: number, path: string, lineIndex: number) {
  return `${repositoryFullName}:${prNumber}:${path}:${lineIndex}`;
}

function getPullRequestStateKey(repositoryFullName: string, prNumber: number) {
  return `${repositoryFullName}:${prNumber}`;
}

function countReviewCommentsForFile(comments: Record<string, string[]>, repositoryFullName: string, prNumber: number, path: string) {
  const prefix = `${repositoryFullName}:${prNumber}:${path}:`;
  return Object.entries(comments).reduce((total, [key, values]) => (
    key.startsWith(prefix) ? total + values.length : total
  ), 0);
}

type DiffRenderItem =
  | { kind: "line"; line: string; originalIndex: number }
  | { kind: "collapsed"; startIndex: number; count: number };

function buildDiffRenderItems(lines: string[], collapseUnchanged: boolean) {
  if (!collapseUnchanged) {
    return lines.map((line, originalIndex) => ({ kind: "line" as const, line, originalIndex }));
  }

  const items: DiffRenderItem[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!isUnchangedDiffLine(line)) {
      items.push({ kind: "line", line, originalIndex: index });
      index += 1;
      continue;
    }

    let end = index + 1;
    while (end < lines.length && isUnchangedDiffLine(lines[end])) {
      end += 1;
    }

    items.push({ kind: "collapsed", startIndex: index, count: end - index });
    index = end;
  }

  return items;
}

function isUnchangedDiffLine(line: string) {
  return line.startsWith(" ");
}

function isCommentableDiffLine(line: string) {
  return line.startsWith("+") || line.startsWith("-");
}

function isPreviewableImagePath(path: string) {
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(path);
}

function getDiffLineClass(line: string) {
  if (line.startsWith("+")) return "diff-added";
  if (line.startsWith("-")) return "diff-deleted";
  if (line.startsWith("@")) return "diff-hunk";
  return "diff-context";
}

function demoDiff(path: string) {
  return [
    `@@ ${path}`,
    "-  const previousState = loadFromCache(path);",
    "+  const repositoryState = await inspectRepository(path);",
    "+  persistReviewSnapshot(repositoryState);",
    "   if (!repositoryState.worktrees.length) {",
    "-    return emptyResult();",
    "+    return createEmptyResult(path);",
    "   }",
    "+  return normalizeWorktreeStatus(repositoryState);",
  ];
}

async function copyText(text: string, errorMessage: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the textarea fallback for WebViews or unfocused browser documents.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!copied) throw new Error(errorMessage);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function orderRepositories(scannedRepositories: RepositoryInfo[], pinnedRepositories: RepositoryInfo[]) {
  const scannedById = new Map(scannedRepositories.map((repo) => [repo.common_dir, repo]));
  const pinnedIds = new Set(pinnedRepositories.map((repo) => repo.common_dir));
  const pinnedRows = uniqueRepositories(pinnedRepositories).map((repo) => scannedById.get(repo.common_dir) ?? repo);
  const unpinnedRows = scannedRepositories.filter((repo) => !pinnedIds.has(repo.common_dir));
  return [...pinnedRows, ...unpinnedRows];
}

function refreshPinnedRepositories(scannedRepositories: RepositoryInfo[], pinnedRepositories: RepositoryInfo[]) {
  const scannedById = new Map(scannedRepositories.map((repo) => [repo.common_dir, repo]));
  return uniqueRepositories(pinnedRepositories).map((repo) => scannedById.get(repo.common_dir) ?? repo);
}

function upsertRepositoryList(repositories: RepositoryInfo[], nextRepository: RepositoryInfo) {
  const exists = repositories.some((repo) => repo.common_dir === nextRepository.common_dir);
  if (!exists) return [nextRepository, ...repositories];
  return repositories.map((repo) => (repo.common_dir === nextRepository.common_dir ? nextRepository : repo));
}

function uniqueRepositories(repositories: RepositoryInfo[]) {
  const seen = new Set<string>();
  const unique: RepositoryInfo[] = [];
  for (const repo of repositories) {
    if (!repo?.common_dir || seen.has(repo.common_dir)) continue;
    seen.add(repo.common_dir);
    unique.push(repo);
  }
  return unique;
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) {
    await new Promise((resolve) => window.setTimeout(resolve, 240));
    if (command === "scan_directory") {
      return { root: String(args?.root ?? "/Users/joe/Documents/Work"), repositories: demoRepositories } as T;
    }
    if (command === "inspect_path") {
      const path = String(args?.path ?? demoRepositories[0].root);
      return (demoRepositories.find((repo) => repo.root === path) ?? demoRepositories[0]) as T;
    }
    if (command === "list_branches") {
      return [
        { name: "main", current: true, remote: false, upstream: "origin/main" },
        { name: "feature/provider-review", current: false, remote: false, upstream: null },
        { name: "release/2026.05", current: false, remote: false, upstream: "origin/release/2026.05" },
      ] as T;
    }
    if (command === "get_pull_request_file_content") {
      const request = args?.request as { filename?: string } | undefined;
      const filename = request?.filename ?? "src/App.tsx";
      return {
        filename,
        patch: demoDiff(filename).join("\n"),
        image_preview: null,
        binary: false,
        message: null,
      } as T;
    }
    return demoRepositories[0] as T;
  }
  return invoke<T>(command, args);
}

function getErrorMessage(error: unknown, fallback: string) {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return fallback;
}

function getUpdateCheckErrorMessage(error: unknown, t: I18nRuntime["t"]) {
  const message = getErrorMessage(error, t("error.operationFailed"));
  if (message.includes("valid release JSON") || message.includes("release JSON")) {
    return t("error.updateManifest");
  }
  if (message.includes("GitHub Releases returned HTTP 404")) {
    return t("error.noRelease");
  }
  return message;
}

export default App;
