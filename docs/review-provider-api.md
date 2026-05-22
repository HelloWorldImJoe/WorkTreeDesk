# PR 评审接口封装技术文档

## 目标

本次重构将 Gitee 与 GitHub 的 PR 相关接口从单文件过程式实现拆分为“命令分发层 + Provider API 层 + 领域映射层”三层结构，达到以下目标：

1. 将 HTTP 请求细节与评审业务逻辑解耦。
2. 为 GitHub 和 Gitee 提供一致的 PR 数据返回模型。
3. 补充 PR 关联接口封装，覆盖提交列表、变更文件列表、仓库成员列表。
4. 保持现有前端调用入口不被破坏，同时为后续扩展更多平台接口预留稳定边界。

## 模块结构

### 1. 命令分发层

文件：src-tauri/src/review/commands.rs

职责：

- 接收 Tauri 命令请求。
- 根据仓库识别结果分发到 Gitee、GitHub、GitLab。
- 统一处理 repo_path 展开、provider 判定、access token 校验。

当前统一命令包括：

- list_pull_requests
- get_pull_request_detail
- approve_pull_request_review
- approve_pull_request_test
- reset_pull_request_review
- reset_pull_request_test
- list_pull_request_commits
- list_pull_request_files
- list_repository_members
- prepare_code_review
- cleanup_code_review_worktree

### 2. Provider API 层

文件目录：

- src-tauri/src/review/api/github/
- src-tauri/src/review/api/gitee/
- src-tauri/src/review/api/gitlab/

职责：

- 只负责和远端 API 通信。
- 按资源维度拆分为 client、pull_requests、repositories。
- 不关心 Tauri 命令，也不关心本地 worktree 编排。

#### GitHub API 子模块

- client.rs：封装 GitHub 基础请求头、Bearer Token、API Version。
- pull_requests.rs：封装 PR 列表、详情、review、commits、files、commit status。
- repositories.rs：封装仓库 collaborators 与当前认证用户接口。

#### Gitee API 子模块

- client.rs：封装 Gitee access_token query、基础 GET/POST form 请求。
- pull_requests.rs：封装 PR 列表、详情、审查、测试、重置、commits、files。
- repositories.rs：封装仓库 subscribers 接口。

#### GitLab API 子模块

- client.rs：封装 GitLab PRIVATE-TOKEN、基础 GET/POST 请求。
- pull_requests.rs：封装 MR 列表、详情、approvals、commits、changes、审批通过与取消审批。
- repositories.rs：封装当前认证用户、项目信息、项目成员列表接口。

### 3. 领域映射层

文件：

- src-tauri/src/review/github.rs
- src-tauri/src/review/gitee.rs
- src-tauri/src/models/review.rs
- src-tauri/src/models/requests.rs

职责：

- 将不同平台的原始 JSON 映射为统一领域对象。
- 复用现有 worktree 代码评审准备逻辑。
- 封装平台差异，例如 GitHub 自审限制、Gitee review/test 双状态。

## 统一返回模型

文件：src-tauri/src/models/review.rs

新增统一 DTO：

### PullRequestCommitInfo

用于 PR 提交列表。

字段：

- sha：提交 SHA
- message：提交说明
- author：作者名称或登录名
- authored_at：提交时间
- web_url：提交详情地址

### PullRequestChangedFileInfo

用于 PR 文件变更列表。

字段：

- filename：文件路径
- status：变更状态
- additions：新增行数
- deletions：删除行数
- changes：总变更行数
- blob_url：文件页面地址
- raw_url：原始内容地址
- patch：diff 片段

### RepositoryMemberInfo

用于“仓库成员/候选参与人”列表。

字段：

- username：用户名或登录名
- display_name：展示名
- avatar_url：头像地址
- profile_url：个人主页地址
- role_name：角色名
- permission：权限级别

## 请求模型

文件：src-tauri/src/models/requests.rs

本次将原先以 Gitee 命名的请求结构升级为通用结构，并保留旧类型别名以兼容现有调用：

- ReviewProviderListRequest
- ReviewProviderPullRequestRequest
- ReviewProviderPullRequestActionRequest
- ReviewProviderCodeReviewRequest

兼容别名：

- GiteePullRequestListRequest
- GiteePullRequestDetailRequest
- GiteePullRequestActionRequest
- GiteeCodeReviewRequest

这样既保留了当前前端协议，又避免新增接口继续沿用 Gitee 前缀。

## 接口封装清单

### GitHub

基础 API 目录：src-tauri/src/review/api/github/

已封装接口：

| 资源 | 方法 | 远端接口 |
| --- | --- | --- |
| PR 列表 | GET | /repos/{owner}/{repo}/pulls |
| PR 详情 | GET | /repos/{owner}/{repo}/pulls/{number} |
| PR review 列表 | GET | /repos/{owner}/{repo}/pulls/{number}/reviews |
| PR 提交列表 | GET | /repos/{owner}/{repo}/pulls/{number}/commits |
| PR 文件列表 | GET | /repos/{owner}/{repo}/pulls/{number}/files |
| PR 审批通过 | POST | /repos/{owner}/{repo}/pulls/{number}/reviews |
| Head Commit 状态 | GET | /repos/{owner}/{repo}/commits/{sha}/status |
| 当前认证用户 | GET | /user |
| 仓库成员列表 | GET | /repos/{owner}/{repo}/collaborators |

实现要点：

- 使用 Accept: application/vnd.github+json。
- 统一带上 X-GitHub-Api-Version: 2022-11-28。
- review 审批通过通过创建 review 事件 APPPROVE 实现。
- 仓库成员使用 collaborators 端点，兼容组织仓库与个人仓库。

### Gitee

基础 API 目录：src-tauri/src/review/api/gitee/

已封装接口：

| 资源 | 方法 | 远端接口 |
| --- | --- | --- |
| PR 列表 | GET | /repos/{owner}/{repo}/pulls |
| PR 详情 | GET | /repos/{owner}/{repo}/pulls/{number} |
| PR 提交列表 | GET | /repos/{owner}/{repo}/pulls/{number}/commits |
| PR 文件列表 | GET | /repos/{owner}/{repo}/pulls/{number}/files |
| PR 审查通过 | POST | /repos/{owner}/{repo}/pulls/{number}/review |
| PR 测试通过 | POST | /repos/{owner}/{repo}/pulls/{number}/test |
| 重置审查状态 | POST | /repos/{owner}/{repo}/pulls/{number}/review/reset |
| 重置测试状态 | POST | /repos/{owner}/{repo}/pulls/{number}/test/reset |
| 仓库参与人列表 | GET | /repos/{owner}/{repo}/subscribers |

实现要点：

- 使用 Gitee access_token query 参数模式。
- 审查通过与测试通过分别保留独立接口，符合 Gitee 的双状态模型。
- 当前公开 Swagger 中可以稳定确认的关联仓库人员接口为 subscribers。
- 因 Gitee 文档未在本次改造中稳定定位到与 GitHub collaborators 完全对等的仓库协作者接口，所以统一命令 list_repository_members 在 Gitee 侧当前返回 subscribers，并在 role_name 中显式标记为 subscriber。

### GitLab

基础 API 目录：src-tauri/src/review/api/gitlab/

已封装接口：

| 资源 | 方法 | 远端接口 |
| --- | --- | --- |
| MR 列表 | GET | /projects/{project}/merge_requests |
| MR 详情 | GET | /projects/{project}/merge_requests/{iid} |
| MR approvals | GET | /projects/{project}/merge_requests/{iid}/approvals |
| MR 提交列表 | GET | /projects/{project}/merge_requests/{iid}/commits |
| MR 文件列表 | GET | /projects/{project}/merge_requests/{iid}/changes |
| MR 审批通过 | POST | /projects/{project}/merge_requests/{iid}/approve |
| MR 取消审批 | POST | /projects/{project}/merge_requests/{iid}/unapprove |
| 当前认证用户 | GET | /user |
| 项目信息 | GET | /projects/{project_id} |
| 项目成员列表 | GET | /projects/{project}/members/all |

实现要点：

- 使用 GitLab PRIVATE-TOKEN 请求头认证。
- 统一命令 list_pull_request_commits、list_pull_request_files、list_repository_members 已支持 GitLab 分发。
- 变更文件列表当前基于 /changes 返回的 diff 片段推导 additions / deletions / changes。
- 项目成员列表基于 members/all，并把 access_level 映射为 role_name 与 permission。

## 平台差异处理

### 1. 审批能力差异

- GitHub：支持 review approval，但不支持本工作流中的“测试通过/测试重置”。
- Gitee：支持 review 与 test 两条独立状态流。
- GitLab：支持 approval / unapprove、commits / files / members 统一命令，但测试状态仍然是只读的 pipeline 状态，不支持手工“测试通过/测试重置”。

### 2. 用户身份差异

- GitHub 使用 /user 获取当前登录人，并在审批前阻止“审批自己的 PR”。
- Gitee 当前已有流程中不依赖当前用户判定，不额外引入此检查。

### 3. 仓库成员语义差异

- GitHub：成员列表采用 collaborators，语义接近“对仓库有访问权限的协作者”。
- Gitee：当前采用 subscribers，语义更接近“关注仓库的用户”。
- GitLab：成员列表采用 members/all，语义接近“对项目具有某级访问权限的成员”。

因此，统一命令层返回的是“可供 UI 使用的参与人列表”，而不是强约束的跨平台 ACL 定义。

## 本地代码评审流程保持不变

以下能力没有改动公共行为，仅调整了其依赖的远端 PR 获取实现：

- prepare_code_review
- cleanup_code_review_worktree

仍然由以下共享模块负责：

- src-tauri/src/review/shared.rs

流程包括：

1. 获取 PR base/head 分支。
2. 拉取到内部 refs。
3. 在 CodeReview 目录创建或复用 worktree。
4. 在本地合成可评审分支。

## 扩展建议

后续如果继续扩展 PR 生态接口，建议沿用当前目录规范：

1. 新增远端接口时，优先放进 review/api/{provider}/pull_requests.rs 或 repositories.rs。
2. 只有在需要跨平台统一展示时，才在 review/github.rs 或 review/gitee.rs 中做领域映射。
3. 新接口若需要前端调用，再在 review/commands.rs 中追加统一命令。
4. 尽量先扩充统一 DTO，再考虑平台专属字段，避免 UI 重新分叉。

## 当前交付结果

本次交付已经完成：

- GitHub PR 相关接口模块化封装。
- Gitee PR 相关接口模块化封装。
- GitHub 仓库成员接口封装。
- Gitee 仓库参与人接口封装。
- PR 提交列表与文件列表统一封装。
- Tauri 通用命令注册。
- Rust 编译校验通过，无错误无告警。
