# FetchForge MVP (Phase 1)

## Scope
- Paste one or multiple URLs and download sequentially via FetchForge.
- Show task list with status and errors.
- In-memory tasks only (no persistence).

## Frontend
- Textarea for URLs separated by whitespace.
- Download button creates tasks and starts downloads.
- Task list shows title, URL, status, output path, progress, and error message.
- Delete button removes a task from history.
- Cmd/Ctrl + Enter submits downloads.
- Light/dark theme toggle.
- Live updates via Wails events (`task:update`).
- Open-folder button on successful tasks.

## Backend
- Task model fields: id, url, title, status, outputPath, errorMessage, createdAt, updatedAt.
- URL parsing extracts `http`/`https` strings from pasted text.
- Sequential downloads in a single goroutine (no concurrency).
- Executes `yt-dlp` as a subprocess with `-o <outputDir>/%(title)s.%(ext)s <url>`.
- Output directory: `~/.fetchforge/downloads/<YYYY-MM-DD>/`.
- Error handling stores stderr on failure.
- Best-effort output path: newest file in task folder.
- Task history persists to `~/.fetchforge/tasks.json` and loads on startup.

## Wails Bindings
- `CreateTasksFromText(text string) ([]Task, error)`
- `ListTasks() ([]Task, error)`
- `OpenTaskFolder(id string) error`
