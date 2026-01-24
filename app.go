package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx context.Context
	mu  sync.Mutex

	tasks map[string]*Task
	order []string
	queue chan string
}

// Task represents a download task.
type Task struct {
	ID           string    `json:"id"`
	URL          string    `json:"url"`
	Title        string    `json:"title"`
	Status       string    `json:"status"`
	OutputPath   string    `json:"outputPath"`
	ErrorMessage string    `json:"errorMessage"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

const (
	statusQueued  = "Queued"
	statusRunning = "Running"
	statusSuccess = "Success"
	statusFailed  = "Failed"
)

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		tasks: make(map[string]*Task),
		order: make([]string, 0),
		queue: make(chan string, 100),
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
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
			Title:     "Pending title",
			Status:    statusQueued,
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

func (a *App) worker() {
	for id := range a.queue {
		a.runTask(id)
	}
}

func (a *App) runTask(id string) {
	a.mu.Lock()
	task, ok := a.tasks[id]
	if !ok {
		a.mu.Unlock()
		return
	}
	task.Status = statusRunning
	task.UpdatedAt = time.Now()
	url := task.URL
	updated := *task
	a.mu.Unlock()
	a.emitTaskUpdate(updated)

	outputDir, err := taskOutputDir(id)
	if err != nil {
		a.failTask(id, "failed to resolve output directory")
		return
	}
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		a.failTask(id, "failed to create output directory")
		return
	}

	cmd := exec.Command("lux", "-o", outputDir, url)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		msg := stderr.String()
		if msg == "" {
			msg = err.Error()
		}
		a.failTask(id, msg)
		return
	}

	outputPath := newestFilePath(outputDir)
	a.mu.Lock()
	task, ok = a.tasks[id]
	if !ok {
		a.mu.Unlock()
		return
	}
	task.Status = statusSuccess
	task.OutputPath = outputPath
	task.ErrorMessage = ""
	task.UpdatedAt = time.Now()
	updated = *task
	a.mu.Unlock()

	a.emitTaskUpdate(updated)
}

func (a *App) failTask(id, message string) {
	a.mu.Lock()
	task, ok := a.tasks[id]
	if !ok {
		a.mu.Unlock()
		return
	}
	task.Status = statusFailed
	task.ErrorMessage = message
	task.UpdatedAt = time.Now()
	updated := *task
	a.mu.Unlock()

	a.emitTaskUpdate(updated)
}

func (a *App) emitTaskUpdate(task Task) {
	if a.ctx == nil {
		return
	}
	runtime.EventsEmit(a.ctx, "task:update", task)
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

func newID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return hex.EncodeToString([]byte(time.Now().Format("20060102150405.000000000")))
	}
	return hex.EncodeToString(buf)
}

func taskOutputDir(id string) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".luxdesk", "downloads", id), nil
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
