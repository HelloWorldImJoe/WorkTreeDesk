import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// Translation data
// ---------------------------------------------------------------------------

const translations = {
  en: {
    "brand.title": "Worktree Desk",
    "brand.subtitle": "Git worktree control panel",
    "nav.workspace": "Workspace",
    "nav.reviews": "Reviews",
    "sidebar.scanDir": "Scan directory",
    "sidebar.chooseDir": "Choose directory",
    "sidebar.scan": "Scan",
    "sidebar.repos": "Repositories",
    "sidebar.showHidden": (n: number) => n > 0 ? `Show ${n} hidden repos` : "Show hidden repositories",
    "sidebar.hideHidden": "Hide hidden repositories",
    "sidebar.hideRepo": "Hide repository",
    "sidebar.showRepo": "Restore repository",
    "sidebar.allHidden": "All repositories are hidden.",
    "sidebar.noRepos": "No repositories scanned yet.",
    "sidebar.worktrees": (n: number) => `${n} worktrees`,
    "toolbar.currentRepo": "Current repository",
    "toolbar.noRepo": "No repository selected",
    "panel.addWorktree": "Add worktree",
    "panel.repoTools": "Repository tools",
    "panel.worktreeInspector": "Worktree inspector",
    "panel.reviewActions": "Review actions",
    "panel.repoBranch": (branch: string) => `Repository branch: ${branch}`,
    "panel.branch": "Branch",
    "panel.branchPlaceholder": "feature/refactor",
    "panel.worktreePath": "Worktree path",
    "panel.pathPlaceholder": "Select a branch first",
    "panel.chooseFolder": "Choose worktree folder",
    "panel.hint": "Missing branches are confirmed before creation.",
    "panel.add": "Add",
    "dashboard.controlsTitle": "Workspace controls",
    "dashboard.worktreeTitle": "Worktrees",
    "dashboard.branch": "Current branch",
    "dashboard.worktrees": "Worktrees",
    "dashboard.prunable": "Prunable",
    "dashboard.reviewQueue": "Open reviews",
    "settings.title": "Workspace settings",
    "settings.editor": "Repository editor",
    "settings.editorHint": "Saved per repository and applied only to the current repository.",
    "settings.cleanup": "operation on temporary directory after review completion", 
    "settings.cleanupAsk": "Ask every time",
    "settings.cleanupDelete": "Auto-delete worktree",
    "settings.cleanupKeep": "Keep worktree",
    "refresh": "Refresh",
    "prune": "Prune",
    "status.ready": "Ready",
    "empty.title": "Scan a directory to find Git worktrees",
    "empty.hiddenReposTitle": "All repositories are hidden",
    "empty.hiddenReposHint": "Show hidden repositories to restore them.",
    "empty.selectWorktree": "Select a worktree to inspect details and actions.",
    "empty.reviewAuth": "Add your Gitee API Key in the right panel to load the review queue.",
    "badge.prunable": "Prunable",
    "badge.detached": "Detached",
    "badge.hidden": "Hidden",
    "badge.ready": "Ready",
    "card.finder": "Finder",
    "card.finderTitle": "Open in Finder",
    "card.openEditor": (editor: string) => `Open in ${editor}`,
    "card.remove": "Remove",
    "card.removeTitle": "Remove worktree",
    "card.detached": "detached",
    "card.unknown": "unknown",
    "checkbox.force": "Force remove worktrees with local changes",
    "modal.removeTitle": "Remove worktree?",
    "modal.cancel": "Cancel",
    "modal.remove": "Remove",
    "modal.createBranchTitle": "Create new branch?",
    "modal.createBranchDesc": (branch: string, path: string) =>
      `Branch ${branch} was not found. Create it from the current repository HEAD and add the worktree at ${path}?`,
    "modal.create": "Create",
    "combo.noBranches": "No branches found",
    "combo.loading": "Loading branches...",
    "combo.remote": "remote",
    "busy.working": "Working...",
    "refresh.refreshing": "Refreshing repository...",
    "refresh.complete": "Repository refreshed",
    "scan.scanning": "Scanning repositories...",
    "scan.complete": "Scan complete",
    "worktree.adding": "Adding worktree...",
    "worktree.added": "Worktree added",
    "worktree.creating": "Creating branch and worktree...",
    "worktree.removing": "Removing worktree...",
    "worktree.removed": "Worktree removed",
    "worktree.forceToggle": "Force remove mode",
    "prune.pruning": "Pruning worktrees...",
    "prune.complete": "Prune complete",
    "open.opened": "Opened",
    "open.opening": "Opening folder...",
    "open.openingLink": "Opening link...",
    "gitee.repo": "Gitee repository",
    "gitee.noRepo": "No Gitee repository detected",
    "gitee.unavailable": "This repository does not expose a gitee.com remote yet.",
    "gitee.apiKey": "Gitee API Key",
    "gitee.apiKeyPlaceholder": "Paste your Gitee access token",
    "gitee.tokenHint": "Add a Gitee API Key to load open PR/MRs and perform review actions.",
    "gitee.openCount": (n: number) => `${n} open PR/MRs`,
    "gitee.listTitle": "Open PR / MR",
    "gitee.listHint": "Only open PR / MR are shown.",
    "gitee.listEmpty": "No open PR / MR found.",
    "gitee.openFallback": "Open",
    "gitee.detailTitle": "PR / MR details",
    "gitee.selectHint": "Select a PR / MR to view details.",
    "gitee.loadingList": "Loading open PR / MR...",
    "gitee.loadingDetail": "Loading PR / MR details...",
    "gitee.author": "Author",
    "gitee.createdAt": "Created",
    "gitee.updatedAt": "Updated",
    "gitee.sourceBranch": "Source branch",
    "gitee.targetBranch": "Target branch",
    "gitee.sourceRepo": "Source repository",
    "gitee.targetRepo": "Target repository",
    "gitee.reviewStatus": "Review status",
    "gitee.testStatus": "Test status",
    "gitee.description": "Description",
    "gitee.noDescription": "No description.",
    "gitee.codeReview": "CodeReview",
    "gitee.codeReviewPreparing": "Preparing CodeReview worktree...",
    "gitee.codeReviewReady": "CodeReview worktree is ready",
    "gitee.reviewComplete": "Review complete",
    "gitee.reviewCompleteDoing": "Completing review...",
    "gitee.reviewCompleteDone": "Review completed",
    "gitee.reviewDone": "Review done",
    "gitee.reviewPass": "Approve review",
    "gitee.reviewPassing": "Approving review...",
    "gitee.reviewPassed": "Review approved",
    "gitee.reviewReset": "Cancel review approval",
    "gitee.reviewResetting": "Canceling review approval...",
    "gitee.reviewResetDone": "Review approval canceled",
    "gitee.testPass": "Mark test passed",
    "gitee.testPassing": "Marking test passed...",
    "gitee.testPassed": "Test marked as passed",
    "gitee.testReset": "Cancel test pass",
    "gitee.testResetting": "Canceling test pass...",
    "gitee.testResetDone": "Test pass canceled",
    "gitee.cleanupTitle": "Delete CodeReview worktree?",
    "gitee.cleanupDesc": (title: string) => `Review for \"${title}\" is complete. Delete the temporary CodeReview worktree folder?`,
    "gitee.cleanupDelete": "Delete now",
    "gitee.cleanupKeep": "Keep it",
    "gitee.cleanupDeleting": "Deleting CodeReview worktree...",
    "gitee.cleanupDeleted": "CodeReview worktree deleted",
    "gitee.moreActions": "Additional actions",
    "gitee.openWeb": "Open PR / MR",
    "gitee.openRepo": "Open repo",
    "gitee.panelCollapsed": "Review list is hidden. Expand it to continue.",
    "gitee.countDisabled": "Add your Gitee API Key first",
    "gitee.refreshList": "Refresh PR / MR",
    "gitee.openReviewWindow": "Review window",
    "gitee.unknown": "Unknown",
    "gitee.branchUnknown": "Unknown branch",
    "theme.light": "Light",
    "theme.dark": "Dark",
    "theme.system": "System",
    "lang.switch": "中文",
  },

  zh: {
    "brand.title": "Worktree Desk",
    "brand.subtitle": "Git 工作树管理面板",
    "nav.workspace": "工作区",
    "nav.reviews": "评审",
    "sidebar.scanDir": "扫描目录",
    "sidebar.chooseDir": "选择目录",
    "sidebar.scan": "扫描",
    "sidebar.repos": "仓库",
    "sidebar.showHidden": (n: number) => n > 0 ? `显示已隐藏的 ${n} 个仓库` : "显示已隐藏仓库",
    "sidebar.hideHidden": "仅显示未隐藏仓库",
    "sidebar.hideRepo": "隐藏仓库",
    "sidebar.showRepo": "恢复仓库",
    "sidebar.allHidden": "当前仓库都已隐藏。",
    "sidebar.noRepos": "尚未扫描任何仓库。",
    "sidebar.worktrees": (n: number) => `${n} 个 worktree`,
    "toolbar.currentRepo": "当前仓库",
    "toolbar.noRepo": "未选择仓库",
    "panel.addWorktree": "添加 worktree",
    "panel.repoTools": "仓库工具",
    "panel.worktreeInspector": "Worktree 详情",
    "panel.reviewActions": "评审操作",
    "panel.repoBranch": (branch: string) => `仓库分支：${branch}`,
    "panel.branch": "分支",
    "panel.branchPlaceholder": "feature/refactor",
    "panel.worktreePath": "Worktree 路径",
    "panel.pathPlaceholder": "请先选择分支",
    "panel.chooseFolder": "选择 worktree 文件夹",
    "panel.hint": "不存在的分支会在确认后自动创建。",
    "panel.add": "添加",
    "dashboard.controlsTitle": "工作区控制",
    "dashboard.worktreeTitle": "Worktrees",
    "dashboard.branch": "当前分支",
    "dashboard.worktrees": "Worktrees 数量",
    "dashboard.prunable": "可清理",
    "dashboard.reviewQueue": "待处理评审",
    "settings.title": "工作区设置",
    "settings.editor": "仓库默认编辑器",
    "settings.editorHint": "按仓库单独保存，仅对当前仓库生效。",
    "settings.cleanup": "评审完成后, 操作临时目录",
    "settings.cleanupAsk": "每次询问",
    "settings.cleanupDelete": "自动删除临时目录",
    "settings.cleanupKeep": "保留临时目录",
    "refresh": "刷新",
    "prune": "清理",
    "status.ready": "就绪",
    "empty.title": "扫描目录以查找 Git worktree",
    "empty.hiddenReposTitle": "当前仓库都已隐藏",
    "empty.hiddenReposHint": "显示已隐藏仓库后即可恢复。",
    "empty.selectWorktree": "选择一个 worktree 以查看详情和操作。",
    "empty.reviewAuth": "请在右侧面板填写 Gitee API Key 以加载评审队列。",
    "badge.prunable": "可清理",
    "badge.detached": "游离",
    "badge.hidden": "已隐藏",
    "badge.ready": "就绪",
    "card.finder": "访达",
    "card.finderTitle": "在访达中打开",
    "card.openEditor": (editor: string) => `在 ${editor} 中打开`,
    "card.remove": "移除",
    "card.removeTitle": "移除 worktree",
    "card.detached": "游离",
    "card.unknown": "未知",
    "checkbox.force": "强制移除有本地更改的 worktree",
    "modal.removeTitle": "确认移除 worktree？",
    "modal.cancel": "取消",
    "modal.remove": "移除",
    "modal.createBranchTitle": "创建新分支？",
    "modal.createBranchDesc": (branch: string, path: string) =>
      `未找到分支 ${branch}。是否从当前仓库 HEAD 创建该分支并添加 worktree 到 ${path}？`,
    "modal.create": "创建",
    "combo.noBranches": "未找到分支",
    "combo.loading": "正在加载分支...",
    "combo.remote": "远程",
    "busy.working": "处理中...",
    "refresh.refreshing": "正在刷新仓库...",
    "refresh.complete": "仓库已刷新",
    "scan.scanning": "正在扫描仓库...",
    "scan.complete": "扫描完成",
    "worktree.adding": "正在添加 worktree...",
    "worktree.added": "Worktree 已添加",
    "worktree.creating": "正在创建分支并添加 worktree...",
    "worktree.removing": "正在移除 worktree...",
    "worktree.removed": "Worktree 已移除",
    "worktree.forceToggle": "强制移除模式",
    "prune.pruning": "正在清理 worktree...",
    "prune.complete": "清理完成",
    "open.opened": "已打开",
    "open.opening": "正在打开文件夹...",
    "open.openingLink": "正在打开链接...",
    "gitee.repo": "Gitee 仓库",
    "gitee.noRepo": "未识别到 Gitee 仓库",
    "gitee.unavailable": "当前仓库还没有可识别的 gitee.com remote。",
    "gitee.apiKey": "Gitee API Key",
    "gitee.apiKeyPlaceholder": "输入你的 Gitee Access Token",
    "gitee.tokenHint": "添加 Gitee API Key 后，即可加载开启中的 PR/MR 并执行评审动作。",
    "gitee.openCount": (n: number) => `${n} 个开启中的 PR/MR`,
    "gitee.listTitle": "开启中的 PR / MR",
    "gitee.listHint": "这里只展示开启中的 PR / MR。",
    "gitee.listEmpty": "当前没有开启中的 PR / MR。",
    "gitee.openFallback": "开启中",
    "gitee.detailTitle": "PR / MR 详情",
    "gitee.selectHint": "选择一个 PR / MR 查看详情。",
    "gitee.loadingList": "正在加载开启中的 PR / MR...",
    "gitee.loadingDetail": "正在加载 PR / MR 详情...",
    "gitee.author": "作者",
    "gitee.createdAt": "创建时间",
    "gitee.updatedAt": "更新时间",
    "gitee.sourceBranch": "源分支",
    "gitee.targetBranch": "目标分支",
    "gitee.sourceRepo": "源仓库",
    "gitee.targetRepo": "目标仓库",
    "gitee.reviewStatus": "评审状态",
    "gitee.testStatus": "测试状态",
    "gitee.description": "描述",
    "gitee.noDescription": "暂无描述。",
    "gitee.codeReview": "CodeReview",
    "gitee.codeReviewPreparing": "正在准备 CodeReview worktree...",
    "gitee.codeReviewReady": "CodeReview worktree 已准备完成",
    "gitee.reviewComplete": "Review完成",
    "gitee.reviewCompleteDoing": "正在完成评审...",
    "gitee.reviewCompleteDone": "评审已完成",
    "gitee.reviewDone": "已完成",
    "gitee.reviewPass": "评审通过",
    "gitee.reviewPassing": "正在提交评审通过...",
    "gitee.reviewPassed": "评审已通过",
    "gitee.reviewReset": "取消评审通过",
    "gitee.reviewResetting": "正在取消评审通过...",
    "gitee.reviewResetDone": "已取消评审通过",
    "gitee.testPass": "测试通过",
    "gitee.testPassing": "正在提交测试通过...",
    "gitee.testPassed": "测试已标记通过",
    "gitee.testReset": "取消测试通过",
    "gitee.testResetting": "正在取消测试通过...",
    "gitee.testResetDone": "已取消测试通过",
    "gitee.cleanupTitle": "删除 CodeReview 临时目录？",
    "gitee.cleanupDesc": (title: string) => `《${title}》评审完成后，是否删除 CodeReview 创建的临时 worktree 文件夹？`,
    "gitee.cleanupDelete": "删除临时目录",
    "gitee.cleanupKeep": "先保留",
    "gitee.cleanupDeleting": "正在删除 CodeReview 临时目录...",
    "gitee.cleanupDeleted": "CodeReview 临时目录已删除",
    "gitee.moreActions": "补充操作",
    "gitee.openWeb": "打开 PR / MR",
    "gitee.openRepo": "打开仓库",
    "gitee.panelCollapsed": "评审列表当前已收起，展开后可继续处理。",
    "gitee.countDisabled": "请先填写 Gitee API Key",
    "gitee.refreshList": "刷新 PR / MR",
    "gitee.openReviewWindow": "评审窗口",
    "gitee.unknown": "未知",
    "gitee.branchUnknown": "未知分支",
    "theme.light": "浅色",
    "theme.dark": "深色",
    "theme.system": "系统",
    "lang.switch": "English",
  },
};

type Locale = "en" | "zh";
type TranslationKey = keyof typeof translations.en;

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, ...args: any[]) => string;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: "en",
  setLocale: () => {},
  t: (key) => key,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectSystemLocale(): Locale {
  if (typeof navigator === "undefined") return "en";
  return navigator.language.startsWith("zh") ? "zh" : "en";
}

const STORAGE_KEY = "worktree-desk.locale";

function readStoredLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "zh" || stored === "en") return stored;
  } catch {}
  return detectSystemLocale();
}

function persistLocale(locale: Locale) {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {}
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readStoredLocale);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

  const setLocale = (next: Locale) => {
    setLocaleState(next);
    persistLocale(next);
  };

  const t = (key: TranslationKey, ...args: any[]) => {
    const fn = translations[locale][key] ?? translations.en[key];
    if (fn == null) return key;
    if (typeof fn === "function") return (fn as (...a: any[]) => string)(...args);
    return fn;
  };

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}
