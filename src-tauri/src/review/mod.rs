//! 代码评审模块：聚合平台 API、通用命令和平台特定实现。
// review 目录按“命令入口 + 平台实现 + 共享工具”拆分，避免一个文件同时承载
// Tauri 命令分发、平台 API 适配和 git worktree 编排三类职责。
mod api;
pub(crate) mod commands;
pub(crate) mod gitee;
mod github;
mod gitlab;
mod shared;
