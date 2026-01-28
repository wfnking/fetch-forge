package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx context.Context
	mu  sync.Mutex

	tasks map[string]*Task
	order []string
	queue chan string

	activeProfileID string
	lastCommand     string
	ytDlpPath       string
}

// Task represents a download task.
type Task struct {
	ID           string    `json:"id"`
	URL          string    `json:"url"`
	Title        string    `json:"title"`
	SourceHost   string    `json:"sourceHost"`
	Status       string    `json:"status"`
	Stage        string    `json:"stage"`
	Progress     string    `json:"progress"`
	Speed        string    `json:"speed"`
	ETA          string    `json:"eta"`
	OutputPath   string    `json:"outputPath"`
	MissingOutput bool     `json:"missingOutput"`
	ErrorMessage string    `json:"errorMessage"`
	Resume       bool      `json:"resume"`
	Duration     int       `json:"duration"`
	Filesize     int64     `json:"filesize"`
	Width        int       `json:"width"`
	Height       int       `json:"height"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

const (
	statusQueued  = "Queued"
	statusRunning = "Running"
	statusSuccess = "Success"
	statusFailed  = "Failed"
)

const maxConcurrentDownloads = 3

type Profile struct {
	ID   string   `json:"id"`
	Name string   `json:"name"`
	Args []string `json:"args"`
}

type appConfig struct {
	ActiveProfileID string `json:"activeProfileId"`
}

const defaultProfileID = "default"

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		tasks:           make(map[string]*Task),
		order:           make([]string, 0),
		queue:           make(chan string, 100),
		activeProfileID: defaultProfileID,
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.ytDlpPath = resolveYtDlpPath()
	a.loadConfig()
	a.loadTasks()
	go a.worker()
}

// CreateTasksFromText parses URLs and enqueues download tasks.
func (a *App) CreateTasksFromText(text string) ([]Task, error) {
	urls := extractURLs(text)
	if len(urls) == 0 {
		return []Task{}, nil
	}

	now := time.Now()
	created := make([]Task, 0, len(urls))
	ids := make([]string, 0, len(urls))

	a.mu.Lock()
	for _, url := range urls {
		id := newID()
		task := &Task{
			ID:        id,
			URL:       url,
			Title:     defaultTitleFromURL(url),
			SourceHost: sourceHostFromURL(url),
			Status:    statusQueued,
			Stage:     "Parse URL",
			CreatedAt: now,
			UpdatedAt: now,
		}
		a.tasks[id] = task
		a.order = append(a.order, id)
		created = append(created, *task)
		ids = append(ids, id)
	}
	a.mu.Unlock()

	for _, task := range created {
		a.emitTaskUpdate(task)
	}
	a.saveTasks()
	for _, task := range created {
		go a.prefetchTaskMetadata(task.ID, task.URL)
	}
	for _, id := range ids {
		a.queue <- id
	}

	return created, nil
}

// ListTasks returns all known tasks in creation order.
func (a *App) ListTasks() ([]Task, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	out := make([]Task, 0, len(a.order))
	for _, id := range a.order {
		if task, ok := a.tasks[id]; ok {
			out = append(out, *task)
		}
	}
	return out, nil
}

// DeleteTask removes a task by id.
func (a *App) DeleteTask(id string) error {
	a.mu.Lock()
	task, ok := a.tasks[id]
	if !ok {
		a.mu.Unlock()
		return errors.New("task not found")
	}
	outputPath := task.OutputPath
	a.mu.Unlock()

	if outputPath != "" {
		if info, err := os.Stat(outputPath); err == nil && !info.IsDir() {
			if err := moveToTrash(outputPath); err != nil {
				return err
			}
		}
	}

	a.mu.Lock()
	delete(a.tasks, id)
	nextOrder := make([]string, 0, len(a.order))
	for _, existing := range a.order {
		if existing != id {
			nextOrder = append(nextOrder, existing)
		}
	}
	a.order = nextOrder
	a.mu.Unlock()

	a.saveTasks()
	return nil
}

// OpenTaskFolder opens the output folder for a task.
func (a *App) OpenTaskFolder(id string) error {
	a.mu.Lock()
	task, ok := a.tasks[id]
	if !ok {
		a.mu.Unlock()
		return errors.New("task not found")
	}
	outputPath := task.OutputPath
	createdAt := task.CreatedAt
	a.mu.Unlock()

	outputDir := ""
	if outputPath != "" {
		outputDir = filepath.Dir(outputPath)
	} else {
		dir, err := taskOutputDir(createdAt)
		if err != nil {
			return err
		}
		outputDir = dir
	}

	info, err := os.Stat(outputDir)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return errors.New("output directory not found")
	}

	return openWithDefaultApp(outputDir)
}

// OpenTaskFile opens the downloaded file with the system default app.
func (a *App) OpenTaskFile(id string) error {
	a.mu.Lock()
	task, ok := a.tasks[id]
	if !ok {
		a.mu.Unlock()
		return errors.New("task not found")
	}
	outputPath := task.OutputPath
	a.mu.Unlock()

	if outputPath == "" {
		return errors.New("output file not available")
	}

	info, err := os.Stat(outputPath)
	if err != nil || info.IsDir() {
		return errors.New("file not found")
	}

	return openWithDefaultApp(outputPath)
}

func (a *App) ListProfiles() ([]Profile, error) {
	return builtinProfiles(), nil
}

func (a *App) SetActiveProfile(profileID string) error {
	if _, ok := findProfileByID(profileID); !ok {
		return errors.New("profile not found")
	}
	a.mu.Lock()
	a.activeProfileID = profileID
	a.mu.Unlock()
	a.saveConfig()
	return nil
}

func (a *App) GetActiveProfile() (Profile, error) {
	profile, _ := a.getActiveProfile()
	return profile, nil
}

func (a *App) OpenPath(path string) error {
	if strings.TrimSpace(path) == "" {
		return errors.New("path is required")
	}
	info, err := os.Stat(path)
	if err != nil {
		return errors.New("path not found")
	}
	if info.IsDir() {
		return openWithDefaultApp(path)
	}
	return openWithDefaultApp(filepath.Dir(path))
}

func (a *App) ExportTasks() (string, error) {
	a.mu.Lock()
	snapshot := make([]Task, 0, len(a.order))
	for _, id := range a.order {
		if task, ok := a.tasks[id]; ok {
			snapshot = append(snapshot, *task)
		}
	}
	a.mu.Unlock()

	data, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (a *App) ExportTasksToFile() (string, error) {
	a.mu.Lock()
	snapshot := make([]Task, 0, len(a.order))
	for _, id := range a.order {
		if task, ok := a.tasks[id]; ok {
			snapshot = append(snapshot, *task)
		}
	}
	a.mu.Unlock()

	data, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		return "", err
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	downloadDir := filepath.Join(home, "Downloads")
	if err := os.MkdirAll(downloadDir, 0o755); err != nil {
		return "", err
	}
	filename := fmt.Sprintf("fetchforge-tasks-%s.json", time.Now().Format("2006-01-02"))
	path := filepath.Join(downloadDir, filename)
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return "", err
	}
	return path, nil
}

func (a *App) ImportTasks(jsonText string, mode string, overwriteDownloaded bool) ([]Task, error) {
	if strings.TrimSpace(jsonText) == "" {
		return nil, errors.New("empty import payload")
	}

	var imported []Task
	if err := json.Unmarshal([]byte(jsonText), &imported); err != nil {
		return nil, errors.New("invalid JSON")
	}

	for i := range imported {
		if strings.TrimSpace(imported[i].ID) == "" {
			return nil, errors.New("task id is required")
		}
		if overwriteDownloaded && imported[i].Status == statusSuccess {
			imported[i].Status = statusQueued
			imported[i].Progress = ""
			imported[i].OutputPath = ""
			imported[i].MissingOutput = false
			imported[i].ErrorMessage = ""
		}
		imported[i].MissingOutput = outputMissing(imported[i].OutputPath)
	}

	switch mode {
	case "merge":
		var enqueueIDs []string
		a.mu.Lock()
		for i := range imported {
			item := imported[i]
			if existing, ok := a.tasks[item.ID]; ok {
				if item.UpdatedAt.After(existing.UpdatedAt) {
					item.CreatedAt = existing.CreatedAt
					*existing = item
				}
				continue
			}
			copy := item
			a.tasks[item.ID] = &copy
			a.order = append(a.order, item.ID)
			if item.Status == statusQueued {
				enqueueIDs = append(enqueueIDs, item.ID)
			}
		}
		out := make([]Task, 0, len(a.order))
		for _, id := range a.order {
			if task, ok := a.tasks[id]; ok {
				out = append(out, *task)
			}
		}
		a.mu.Unlock()
		a.enqueueTasks(enqueueIDs)
		a.saveTasks()
		return out, nil
	case "replace":
		var enqueueIDs []string
		a.mu.Lock()
		a.tasks = make(map[string]*Task, len(imported))
		a.order = make([]string, 0, len(imported))
		for i := range imported {
			item := imported[i]
			copy := item
			a.tasks[item.ID] = &copy
			a.order = append(a.order, item.ID)
			if item.Status == statusQueued {
				enqueueIDs = append(enqueueIDs, item.ID)
			}
		}
		out := make([]Task, 0, len(a.order))
		for _, id := range a.order {
			if task, ok := a.tasks[id]; ok {
				out = append(out, *task)
			}
		}
		a.mu.Unlock()
		a.enqueueTasks(enqueueIDs)
		a.saveTasks()
		return out, nil
	default:
		return nil, errors.New("invalid import mode")
	}
}

func (a *App) getActiveProfile() (Profile, bool) {
	a.mu.Lock()
	activeID := a.activeProfileID
	a.mu.Unlock()
	if profile, ok := findProfileByID(activeID); ok {
		return profile, true
	}
	profile, _ := findProfileByID(defaultProfileID)
	return profile, true
}

// GetTaskFileStatus reports whether a task's output file is ready.
// Returns "ok", "missing", or "pending".
func (a *App) GetTaskFileStatus(id string) (string, error) {
	a.mu.Lock()
	task, ok := a.tasks[id]
	if !ok {
		a.mu.Unlock()
		return "", errors.New("task not found")
	}
	outputPath := task.OutputPath
	a.mu.Unlock()

	if outputPath == "" {
		return "pending", nil
	}

	info, err := os.Stat(outputPath)
	if err != nil || info.IsDir() {
		return "missing", nil
	}

	return "ok", nil
}

// GetTaskResumeStatus reports whether a task has partial output available for resuming.
// Returns "ready" or "none".
func (a *App) GetTaskResumeStatus(id string) (string, error) {
	a.mu.Lock()
	task, ok := a.tasks[id]
	if !ok {
		a.mu.Unlock()
		return "", errors.New("task not found")
	}
	createdAt := task.CreatedAt
	title := strings.TrimSpace(task.Title)
	outputPath := strings.TrimSpace(task.OutputPath)
	filesize := task.Filesize
	status := task.Status
	updatedAt := task.UpdatedAt
	a.mu.Unlock()

	if status == statusRunning && time.Since(updatedAt) < 30*time.Second {
		return "none", nil
	}

	outputDir, err := taskOutputDir(createdAt)
	if err != nil {
		return "none", nil
	}

	if outputPath != "" {
		if info, err := os.Stat(outputPath); err == nil && !info.IsDir() && filesize > 0 {
			if info.Size() < filesize {
				return "ready", nil
			}
		}
	}

	if title == "" || title == "Pending title" {
		return "none", nil
	}

	normalizedTitle := normalizeForMatch(title)
	if normalizedTitle == "" {
		return "none", nil
	}

	found := false
	foundRecentPartial := false
	_ = filepath.WalkDir(outputDir, func(path string, d os.DirEntry, err error) error {
		if found || err != nil || d.IsDir() {
			return nil
		}
		name := d.Name()
		if !isPartialFile(name) {
			return nil
		}
		if info, err := d.Info(); err == nil && info.ModTime().After(createdAt.Add(-1*time.Minute)) {
			foundRecentPartial = true
		}
		normalizedName := normalizeForMatch(name)
		if strings.Contains(normalizedName, normalizedTitle) {
			found = true
		}
		return nil
	})

	if found {
		return "ready", nil
	}
	if foundRecentPartial {
		return "ready", nil
	}
	return "none", nil
}

// ResumeTask re-queues a task to continue an interrupted download.
func (a *App) ResumeTask(id string) error {
	a.mu.Lock()
	task, ok := a.tasks[id]
	if !ok {
		a.mu.Unlock()
		return errors.New("task not found")
	}
	if task.Status == statusRunning && time.Since(task.UpdatedAt) < 30*time.Second {
		a.mu.Unlock()
		return errors.New("task is already running")
	}
	task.Status = statusQueued
	task.Stage = "Resume"
	task.Progress = ""
	task.ErrorMessage = ""
	task.Resume = true
	task.UpdatedAt = time.Now()
	updated := *task
	a.mu.Unlock()

	a.emitTaskUpdate(updated)
	a.saveTasks()
	a.enqueueTasks([]string{id})
	return nil
}

// ForceResumeTask re-queues a task even if it appears to be running.
func (a *App) ForceResumeTask(id string) error {
	a.mu.Lock()
	task, ok := a.tasks[id]
	if !ok {
		a.mu.Unlock()
		return errors.New("task not found")
	}
	task.Status = statusQueued
	task.Stage = "Force Resume"
	task.Progress = ""
	task.ErrorMessage = ""
	task.Resume = true
	task.UpdatedAt = time.Now()
	updated := *task
	a.mu.Unlock()

	a.emitTaskUpdate(updated)
	a.saveTasks()
	a.enqueueTasks([]string{id})
	return nil
}

func openWithDefaultApp(target string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", target)
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", "", target)
	default:
		cmd = exec.Command("xdg-open", target)
	}
	return cmd.Start()
}

func moveToTrash(target string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		script := fmt.Sprintf("tell application \"Finder\" to delete POSIX file %q", target)
		cmd = exec.Command("osascript", "-e", script)
	case "windows":
		command := fmt.Sprintf("Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(%q,'OnlyErrorDialogs','SendToRecycleBin')", target)
		cmd = exec.Command("powershell", "-NoProfile", "-Command", command)
	default:
		cmd = exec.Command("gio", "trash", target)
	}
	if err := cmd.Run(); err != nil {
		return errors.New("failed to move file to trash")
	}
	return nil
}

func (a *App) worker() {
	for i := 0; i < maxConcurrentDownloads; i++ {
		go func() {
			for id := range a.queue {
				a.runTask(id)
			}
		}()
	}
}

func (a *App) enqueueTasks(ids []string) {
	for _, id := range ids {
		a.queue <- id
	}
}

func (a *App) runTask(id string) {
	a.mu.Lock()
	task, ok := a.tasks[id]
	if !ok {
		a.mu.Unlock()
		return
	}
	resumeRequested := task.Resume
	task.Resume = false
	task.Status = statusRunning
	task.Stage = "Resolve metadata"
	task.UpdatedAt = time.Now()
	url := task.URL
	updated := *task
	a.mu.Unlock()
	a.emitTaskUpdate(updated)

	metadata := a.fetchMetadata(url)
	if metadata != nil {
		a.mu.Lock()
		task, ok = a.tasks[id]
		if !ok {
			a.mu.Unlock()
			return
		}
		if shouldUpdateTitle(task.Title) && metadata.Title != "" {
			task.Title = metadata.Title
		}
		if metadata.Duration > 0 {
			task.Duration = metadata.Duration
		}
		if metadata.Filesize > 0 {
			task.Filesize = metadata.Filesize
		}
		if metadata.Width > 0 {
			task.Width = metadata.Width
		}
		if metadata.Height > 0 {
			task.Height = metadata.Height
		}
		task.UpdatedAt = time.Now()
		updated = *task
		a.mu.Unlock()
		a.emitTaskUpdate(updated)
		a.saveTasks()
	}

	outputDir, err := taskOutputDir(task.CreatedAt)
	if err != nil {
		a.failTask(id, "failed to resolve output directory")
		return
	}
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		a.failTask(id, "failed to create output directory")
		return
	}

	a.mu.Lock()
	task, ok = a.tasks[id]
	if !ok {
		a.mu.Unlock()
		return
	}
	task.Stage = "Download"
	task.UpdatedAt = time.Now()
	updated = *task
	a.mu.Unlock()
	a.emitTaskUpdate(updated)

	outputTemplate := filepath.Join(outputDir, "%(title)s.%(ext)s")
	profile, _ := a.getActiveProfile()
	args := []string{"--newline", "--progress-template", "progress:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s"}
	args = append(args, profile.Args...)
	args = append(args, extraYtDlpArgs()...)
	if resumeRequested {
		args = append(args, "--continue")
	}
	args = append(args, "-o", outputTemplate, url)
	a.mu.Lock()
	a.lastCommand = "yt-dlp " + strings.Join(args, " ")
	a.mu.Unlock()
	fmt.Println("FetchForge:", a.lastCommand)
	cmd := a.ytDlpCommand(args...)
	startTime := time.Now()

	stdoutText, stderrText, err := a.runCommandWithProgress(id, cmd)
	if err != nil {
		a.failTask(id, formatCommandError(err, cmd, stdoutText, stderrText))
		return
	}

	a.mu.Lock()
	task, ok = a.tasks[id]
	if !ok {
		a.mu.Unlock()
		return
	}
	task.Stage = "Finalize"
	task.UpdatedAt = time.Now()
	updated = *task
	a.mu.Unlock()
	a.emitTaskUpdate(updated)

	outputPath := newestFilePathAfter(outputDir, startTime)
	if outputPath == "" {
		outputPath = newestFilePath(outputDir)
	}
	a.mu.Lock()
	task, ok = a.tasks[id]
	if !ok {
		a.mu.Unlock()
		return
	}
	task.Status = statusSuccess
	task.Stage = "Finalize"
	task.OutputPath = outputPath
	task.ErrorMessage = ""
	if outputPath != "" {
		if shouldUpdateTitle(task.Title) {
			task.Title = strings.TrimSuffix(filepath.Base(outputPath), filepath.Ext(outputPath))
		}
		if info, err := os.Stat(outputPath); err == nil && !info.IsDir() {
			task.Filesize = info.Size()
		}
	}
	task.MissingOutput = outputMissing(outputPath)
	task.Progress = "100%"
	task.UpdatedAt = time.Now()
	updated = *task
	a.mu.Unlock()

	a.emitTaskUpdate(updated)
	a.saveTasks()
}

func (a *App) failTask(id, message string) {
	a.mu.Lock()
	task, ok := a.tasks[id]
	if !ok {
		a.mu.Unlock()
		return
	}
	task.Status = statusFailed
	task.Stage = "Finalize"
	task.ErrorMessage = message
	task.UpdatedAt = time.Now()
	updated := *task
	a.mu.Unlock()

	a.emitTaskUpdate(updated)
	a.saveTasks()
}

func (a *App) emitTaskUpdate(task Task) {
	if a.ctx == nil {
		return
	}
	wailsruntime.EventsEmit(a.ctx, "task:update", task)
}

func (a *App) prefetchTaskMetadata(id, url string) {
	metadata := a.fetchMetadata(url)
	if metadata == nil {
		return
	}
	a.mu.Lock()
	task, ok := a.tasks[id]
	if !ok {
		a.mu.Unlock()
		return
	}
	if shouldUpdateTitle(task.Title) && metadata.Title != "" {
		task.Title = metadata.Title
	}
	task.UpdatedAt = time.Now()
	updated := *task
	a.mu.Unlock()
	a.emitTaskUpdate(updated)
	a.saveTasks()
}

func (a *App) runCommandWithProgress(id string, cmd *exec.Cmd) (string, string, error) {
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return "", "", err
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return "", "", err
	}

	if err := cmd.Start(); err != nil {
		return "", "", err
	}

	var stdoutBuf bytes.Buffer
	var stderrBuf bytes.Buffer
	stdoutDone := make(chan struct{})
	stderrDone := make(chan struct{})
	parseProgress := func(line string) {
		if strings.HasPrefix(line, "progress:") {
			progress := strings.TrimSpace(strings.TrimPrefix(line, "progress:"))
			if progress != "" {
				a.updateTaskProgress(id, progress)
			}
		}
	}

	go func() {
		readLines(stdoutPipe, &stdoutBuf, parseProgress)
		close(stdoutDone)
	}()

	go func() {
		readLines(stderrPipe, &stderrBuf, parseProgress)
		close(stderrDone)
	}()

	err = cmd.Wait()
	<-stdoutDone
	<-stderrDone

	return stdoutBuf.String(), stderrBuf.String(), err
}

func (a *App) updateTaskProgress(id, progress string) {
	parts := strings.SplitN(progress, "|", 3)
	percent := strings.TrimSpace(parts[0])
	speed := ""
	eta := ""
	if len(parts) > 1 {
		speed = strings.TrimSpace(parts[1])
	}
	if len(parts) > 2 {
		eta = strings.TrimSpace(parts[2])
	}
	a.mu.Lock()
	task, ok := a.tasks[id]
	if !ok {
		a.mu.Unlock()
		return
	}
	if task.Progress == percent && task.Speed == speed && task.ETA == eta {
		a.mu.Unlock()
		return
	}
	task.Progress = percent
	task.Speed = speed
	task.ETA = eta
	task.UpdatedAt = time.Now()
	updated := *task
	a.mu.Unlock()

	a.emitTaskUpdate(updated)
	a.saveTasks()
}

func readLines(reader io.Reader, buffer *bytes.Buffer, onLine func(string)) {
	scanner := bufio.NewScanner(reader)
	for scanner.Scan() {
		line := scanner.Text()
		buffer.WriteString(line)
		buffer.WriteString("\n")
		if onLine != nil {
			onLine(line)
		}
	}
}

func extractURLs(text string) []string {
	re := regexp.MustCompile(`https?://[^\s]+`)
	matches := re.FindAllString(text, -1)
	out := make([]string, 0, len(matches))
	seen := make(map[string]struct{})
	for _, match := range matches {
		if _, ok := seen[match]; ok {
			continue
		}
		seen[match] = struct{}{}
		out = append(out, match)
	}
	return out
}

func defaultTitleFromURL(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "Pending title"
	}
	segment := strings.TrimSpace(filepath.Base(parsed.Path))
	if segment == "." || segment == "/" || segment == "" {
		if parsed.Host != "" {
			return parsed.Host
		}
		return "Pending title"
	}
	name := strings.TrimSuffix(segment, filepath.Ext(segment))
	if name == "" {
		return "Pending title"
	}
	return name
}

func sourceHostFromURL(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	host := strings.TrimPrefix(parsed.Hostname(), "www.")
	return host
}

func outputMissing(outputPath string) bool {
	if strings.TrimSpace(outputPath) == "" {
		return false
	}
	info, err := os.Stat(outputPath)
	if err != nil || info.IsDir() {
		return true
	}
	return false
}

func isPartialFile(name string) bool {
	lower := strings.ToLower(name)
	if strings.Contains(lower, ".part") {
		return true
	}
	if strings.HasSuffix(lower, ".ytdl") {
		return true
	}
	return false
}

func normalizeForMatch(value string) string {
	if value == "" {
		return ""
	}
	var b strings.Builder
	for _, r := range strings.ToLower(value) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func builtinProfiles() []Profile {
	return []Profile{
		{
			ID:   defaultProfileID,
			Name: "Default",
			Args: []string{},
		},
		{
			ID:   "audio-only",
			Name: "Audio Only",
			Args: []string{"-x", "--audio-format", "mp3"},
		},
		{
			ID:   "best-quality",
			Name: "Best Quality",
			Args: []string{"-f", "bv*+ba/b"},
		},
	}
}

func findProfileByID(id string) (Profile, bool) {
	for _, profile := range builtinProfiles() {
		if profile.ID == id {
			return profile, true
		}
	}
	return Profile{}, false
}

func shouldUpdateTitle(title string) bool {
	title = strings.TrimSpace(title)
	if title == "" || title == "Pending title" {
		return true
	}
	isNumeric := true
	isHex := true
	hexLen := 0
	for _, r := range title {
		if r < '0' || r > '9' {
			isNumeric = false
		}
		if (r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F') {
			hexLen++
		} else {
			isHex = false
		}
	}
	if isNumeric {
		return true
	}
	if isHex && hexLen >= 12 {
		return true
	}
	return false
}

func newID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return hex.EncodeToString([]byte(time.Now().Format("20060102150405.000000000")))
	}
	return hex.EncodeToString(buf)
}

func taskOutputDir(createdAt time.Time) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dateFolder := createdAt.Format("2006-01-02")
	return filepath.Join(home, ".fetchforge", "downloads", dateFolder), nil
}

func extraYtDlpArgs() []string {
	raw := strings.TrimSpace(os.Getenv("FETCHFORGE_YTDLP_ARGS"))
	if raw == "" {
		return nil
	}
	return strings.Fields(raw)
}

func resolveYtDlpPath() string {
	if envPath := strings.TrimSpace(os.Getenv("FETCHFORGE_YTDLP_PATH")); envPath != "" {
		if fileExists(envPath) {
			return envPath
		}
	}
	if path, err := exec.LookPath("yt-dlp"); err == nil {
		return path
	}
	candidates := []string{
		"/opt/homebrew/bin/yt-dlp",
		"/usr/local/bin/yt-dlp",
		"/usr/bin/yt-dlp",
	}
	exe, err := os.Executable()
	if err == nil {
		exeDir := filepath.Dir(exe)
		candidates = append(candidates,
			filepath.Join(exeDir, "yt-dlp"),
			filepath.Join(exeDir, "..", "Resources", "yt-dlp"),
		)
	}
	home, err := os.UserHomeDir()
	if err == nil {
		candidates = append(candidates, filepath.Join(home, ".fetchforge", "bin", "yt-dlp"))
	}
	for _, candidate := range candidates {
		if fileExists(candidate) {
			return candidate
		}
	}
	return ""
}

func (a *App) ytDlpCommand(args ...string) *exec.Cmd {
	path := a.ytDlpPath
	if path == "" {
		path = "yt-dlp"
	}
	return exec.Command(path, args...)
}

func fileExists(path string) bool {
	if strings.TrimSpace(path) == "" {
		return false
	}
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return false
	}
	return true
}

func newestFilePath(root string) string {
	var newestPath string
	var newestTime time.Time

	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		modTime := info.ModTime()
		if newestPath == "" || modTime.After(newestTime) {
			newestPath = path
			newestTime = modTime
		}
		return nil
	})

	return newestPath
}

type ytdlpMetadata struct {
	Title          string   `json:"title"`
	Duration       *float64 `json:"duration"`
	Extractor      string   `json:"extractor"`
	Resolution     string   `json:"resolution"`
	Filesize       *float64 `json:"filesize"`
	FilesizeApprox *float64 `json:"filesize_approx"`
	Width          *float64 `json:"width"`
	Height         *float64 `json:"height"`
	Formats        []ytdlpFormat `json:"formats"`
}

type ytdlpFormat struct {
	Resolution     string   `json:"resolution"`
	Width          *float64 `json:"width"`
	Height         *float64 `json:"height"`
	Filesize       *float64 `json:"filesize"`
	FilesizeApprox *float64 `json:"filesize_approx"`
}

type formatInfo struct {
	Resolution string
	Width      int
	Height     int
	Filesize   int64
}

func (a *App) fetchMetadata(targetURL string) *Task {
	if strings.TrimSpace(targetURL) == "" {
		return nil
	}
	args := []string{"--skip-download", "--no-warnings", "--no-playlist", "-J"}
	args = append(args, extraYtDlpArgs()...)
	args = append(args, targetURL)
	cmd := a.ytDlpCommand(args...)
	output, err := cmd.Output()
	if err != nil {
		return nil
	}
	var info ytdlpMetadata
	if err := json.Unmarshal(output, &info); err != nil {
		return nil
	}
	best := pickBestFormat(info.Formats)
	width := floatToInt(info.Width)
	height := floatToInt(info.Height)
	if width == 0 && height == 0 && info.Resolution != "" {
		width, height = parseResolution(info.Resolution)
	}
	if width == 0 && height == 0 {
		width, height = best.Width, best.Height
	}
	filesize := pickFilesize(info.Filesize, info.FilesizeApprox)
	if filesize == 0 {
		filesize = best.Filesize
	}
	source := strings.TrimSpace(info.Extractor)
	if source == "" {
		source = sourceHostFromURL(targetURL)
	}
	metadata := &Task{
		Title:      strings.TrimSpace(info.Title),
		Duration:   floatToInt(info.Duration),
		Filesize:   filesize,
		Width:      width,
		Height:     height,
		SourceHost: source,
	}
	return metadata
}

func floatToInt(value *float64) int {
	if value == nil {
		return 0
	}
	return int(*value)
}

func pickFilesize(primary, fallback *float64) int64 {
	if primary != nil {
		return int64(*primary)
	}
	if fallback != nil {
		return int64(*fallback)
	}
	return 0
}

func pickBestFormat(formats []ytdlpFormat) formatInfo {
	var best formatInfo
	var bestScore int64
	for _, format := range formats {
		filesize := pickFilesize(format.Filesize, format.FilesizeApprox)
		width := floatToInt(format.Width)
		height := floatToInt(format.Height)
		resolution := strings.TrimSpace(format.Resolution)
		if width == 0 && height == 0 && resolution != "" {
			width, height = parseResolution(resolution)
		}
		score := filesize
		if score == 0 {
			score = int64(width * height)
		}
		if score > bestScore {
			bestScore = score
			best = formatInfo{
				Resolution: resolution,
				Width:      width,
				Height:     height,
				Filesize:   filesize,
			}
		}
	}
	return best
}

func parseResolution(value string) (int, int) {
	parts := strings.Split(strings.ToLower(strings.TrimSpace(value)), "x")
	if len(parts) != 2 {
		return 0, 0
	}
	width, err := strconv.Atoi(strings.TrimSpace(parts[0]))
	if err != nil {
		return 0, 0
	}
	height, err := strconv.Atoi(strings.TrimSpace(parts[1]))
	if err != nil {
		return 0, 0
	}
	return width, height
}

func newestFilePathAfter(root string, after time.Time) string {
	var newestPath string
	var newestTime time.Time

	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		modTime := info.ModTime()
		if modTime.Before(after) {
			return nil
		}
		if newestPath == "" || modTime.After(newestTime) {
			newestPath = path
			newestTime = modTime
		}
		return nil
	})

	return newestPath
}

func formatCommandError(err error, cmd *exec.Cmd, stdoutText, stderrText string) string {
	exitCode := ""
	if exitErr, ok := err.(*exec.ExitError); ok {
		exitCode = "exit code " + strconv.Itoa(exitErr.ExitCode())
	}

	commandLine := strings.Join(cmd.Args, " ")
	stdoutText = strings.TrimSpace(stdoutText)
	stderrText = strings.TrimSpace(stderrText)

	parts := []string{"yt-dlp failed"}
	if exitCode != "" {
		parts[0] = parts[0] + " (" + exitCode + ")"
	}
	parts = append(parts, "Command: "+commandLine)
	if stdoutText != "" {
		parts = append(parts, "Stdout:\n"+stdoutText)
	}
	if stderrText != "" {
		parts = append(parts, "Stderr:\n"+stderrText)
	}
	if stdoutText == "" && stderrText == "" {
		parts = append(parts, "Error: "+err.Error())
	}

	return strings.Join(parts, "\n")
}

func (a *App) loadTasks() {
	path, err := tasksFilePath()
	if err != nil {
		return
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}

	var items []Task
	if err := json.Unmarshal(data, &items); err != nil {
		return
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	for _, task := range items {
		copy := task
		a.tasks[task.ID] = &copy
		a.order = append(a.order, task.ID)
	}
}

func (a *App) saveTasks() {
	path, err := tasksFilePath()
	if err != nil {
		return
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return
	}

	a.mu.Lock()
	snapshot := make([]Task, 0, len(a.order))
	for _, id := range a.order {
		if task, ok := a.tasks[id]; ok {
			snapshot = append(snapshot, *task)
		}
	}
	a.mu.Unlock()

	data, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		return
	}

	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0o644); err != nil {
		return
	}
	_ = os.Rename(tmpPath, path)
}

func tasksFilePath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".fetchforge", "tasks.json"), nil
}

func configFilePath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".fetchforge", "config.json"), nil
}

func (a *App) loadConfig() {
	path, err := configFilePath()
	if err != nil {
		return
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	var config appConfig
	if err := json.Unmarshal(data, &config); err != nil {
		return
	}
	if _, ok := findProfileByID(config.ActiveProfileID); !ok {
		return
	}
	a.mu.Lock()
	a.activeProfileID = config.ActiveProfileID
	a.mu.Unlock()
}

func (a *App) saveConfig() {
	path, err := configFilePath()
	if err != nil {
		return
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return
	}
	a.mu.Lock()
	config := appConfig{
		ActiveProfileID: a.activeProfileID,
	}
	a.mu.Unlock()
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return
	}
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0o644); err != nil {
		return
	}
	_ = os.Rename(tmpPath, path)
}
