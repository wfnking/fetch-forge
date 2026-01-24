# FetchForge

FetchForge 是一款桌面级资源下载工具，面向批量链接与高频下载场景。
一键丢链接，剩下交给 FetchForge。

## 功能

- 批量 URL 输入，顺序执行下载任务。
- 支持多类网站资源抓取。
- 本地任务历史，重启后自动恢复。
- 任务列表中可打开文件夹或用系统默认播放器播放文件。
- 当文件路径失效时，提供缺失提示。
- 内置浅色/深色主题与中英切换。
- Wails 桌面应用（macOS/Windows/Linux）。

## 运行环境

- Go（版本见 `go.mod`）。
- Node.js + npm（前端构建）。
- Wails CLI：`go install github.com/wailsapp/wails/v2/cmd/wails@latest`
- `yt-dlp` 已加入 PATH（下载引擎）。

## 快速开始

```bash
# 开发模式（热更新）
wails dev
```

```bash
# 生产构建
wails build
```

## 项目结构

- `app.go` - 后端任务队列、存储与下载执行。
- `main.go` - Wails 启动与窗口配置。
- `frontend/` - React UI 与 Wails 绑定。
- `docs/` - 产品与范围说明。
- `wails.json` - 项目配置。

## 说明

- 下载目录：`~/.fetchforge/downloads/<YYYY-MM-DD>/`
- 任务历史：`~/.fetchforge/tasks.json`

## AI/Automation Handoff

如果你用 AI/脚本改动项目，请注明：
- 执行了哪些命令（或计划执行的命令）。
- 修改了哪些文件。
- 对依赖、路径或系统行为的假设。
