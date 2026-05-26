//! Tauri 库入口：组织后端模块并暴露 run。
mod app;
mod common;
mod git;
mod models;
mod provider;
mod repository;
mod review;
mod system;
mod update;

pub fn run() {
    app::run();
}
