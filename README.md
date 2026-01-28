# FetchForge

FetchForge is a heavyweight desktop forge for harvesting resources from across the web.
Drop in one link or a whole batch and let FetchForge do the heavy lifting.

中文版请见 `README.zh.md`.

## Features

- Batch URLs and run a focused download pipeline.
- Handle resources from a wide range of websites.
- Local task history that survives restarts.
- Open output folders or play files with the system default app.
- File-missing hints when the output path no longer exists.
- Built-in light/dark themes and EN/中文 toggle.
- Cross-platform Wails desktop app (macOS/Windows/Linux).

## Architecture

```
[React UI] -> (Wails bridge) -> [Go Backend: Task Queue + Storage]
                              -> [Download Engine (yt-dlp)]
                              -> [Filesystem: downloads + cover cache]
```

Persistence:
- Tasks: `~/.fetchforge/tasks.json`
- Config: `~/.fetchforge/config.json`

## Design Philosophy

- Local-first
- Engine-agnostic
- Transparent errors
- Minimal UI, strong workflow

## Notes

- Downloads are saved under `~/.fetchforge/downloads/<YYYY-MM-DD>/`.
- Task history persists to `~/.fetchforge/tasks.json`.

## Prerequisites

- Go (see `go.mod` for the version).
- Node.js + npm (for the frontend build).
- Wails CLI (`go install github.com/wailsapp/wails/v2/cmd/wails@latest`).
- `yt-dlp` in your PATH (download engine).

## Quick Start

```bash
# Dev mode (hot reload)
wails dev
```

```bash
# Production build
wails build
```

## Project Layout

- `app.go` - backend task queue, storage, and download execution.
- `main.go` - Wails app bootstrap and window options.
- `frontend/` - React UI and Wails bindings.
- `docs/` - product notes and scope.
- `wails.json` - project configuration.

## AI/Automation Handoff

If you are automating changes (AI or scripts), include:
- What command you ran (or wanted to run).
- The exact files you touched.
- Any assumptions you made about dependencies, paths, or OS behavior.
