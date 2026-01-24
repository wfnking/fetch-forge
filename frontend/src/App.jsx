import {useEffect, useRef, useState} from 'react';
import './App.css';
import {
    CreateTasksFromText,
    DeleteTask,
    ExportTasksToFile,
    GetActiveProfile,
    GetTaskFileStatus,
    ImportTasks,
    ListProfiles,
    ListTasks,
    OpenPath,
    OpenTaskFile,
    OpenTaskFolder,
    SetActiveProfile
} from "../wailsjs/go/main/App";
import {BrowserOpenURL, EventsOff, EventsOn} from "../wailsjs/runtime/runtime";

const parseProgress = (value) => {
    if (!value) {
        return 0;
    }
    const match = value.match(/(\d+(\.\d+)?)/);
    if (!match) {
        return 0;
    }
    const parsed = Number(match[1]);
    if (Number.isNaN(parsed)) {
        return 0;
    }
    return Math.min(100, Math.max(0, parsed));
};

const defaultProfileID = "default";

const formatDateTime = (value) => {
    if (!value) {
        return "";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "";
    }
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
    }).format(date);
};

const copy = {
    en: {
        subtitle: "Forge downloads from anywhere. Paste URLs, process in batches, own the pipeline.",
        urlsLabel: "URLs",
        urlsPlaceholder: "Paste one or multiple URLs, separated by spaces or newlines.",
        tip: "Tip: Press Cmd/Ctrl + Enter to download.",
        download: "Download",
        tasks: "Tasks",
        empty: "No tasks yet.",
        delete: "Delete",
        openFolder: "Open folder",
        lightTheme: "Light theme",
        darkTheme: "Dark theme",
        language: "中文",
        progress: "Progress",
        play: "Play",
        profile: "Profile",
        export: "Export",
        import: "Import",
        importTitle: "Import Tasks",
        importHint: "Paste JSON to import. Merge keeps local tasks, replace overwrites.",
        importConfirm: "Import",
        importCancel: "Cancel",
        importPickFile: "Choose file",
        noticeExport: "Exported to",
        noticeOpenFolder: "Open folder",
        noticeClose: "Close",
        noticeImport: "Import completed",
        errors: {
            fileNotFound: "File not found.",
            outputMissing: "File is not available yet."
        },
        meta: {
            duration: "Duration",
            size: "Size",
            resolution: "Resolution",
            source: "Source"
        },
        status: {
            Queued: "Queued",
            Running: "Running",
            Success: "Success",
            Failed: "Failed"
        }
    },
    zh: {
        subtitle: "从任何网站锻造资源。批量粘贴链接，建立你的下载流水线。",
        urlsLabel: "链接",
        urlsPlaceholder: "粘贴一个或多个链接，使用空格或换行分隔。",
        tip: "提示：按 Cmd/Ctrl + Enter 开始下载。",
        download: "下载",
        tasks: "任务",
        empty: "暂无任务。",
        delete: "删除",
        openFolder: "打开文件夹",
        lightTheme: "浅色",
        darkTheme: "深色",
        language: "EN",
        progress: "进度",
        play: "播放",
        profile: "模式",
        export: "导出",
        import: "导入",
        importTitle: "导入任务",
        importHint: "粘贴 JSON 进行导入。合并保留本地任务，替换会覆盖。",
        importConfirm: "确认导入",
        importCancel: "取消",
        importPickFile: "选择文件",
        noticeExport: "已导出到",
        noticeOpenFolder: "打开目录",
        noticeClose: "关闭",
        noticeImport: "导入完成",
        errors: {
            fileNotFound: "文件不存在。",
            outputMissing: "文件尚未生成。"
        },
        meta: {
            duration: "时长",
            size: "大小",
            resolution: "分辨率",
            source: "来源"
        },
        status: {
            Queued: "排队中",
            Running: "下载中",
            Success: "已完成",
            Failed: "失败"
        }
    }
};

function App() {
    const [inputText, setInputText] = useState('');
    const [tasks, setTasks] = useState([]);
    const [theme, setTheme] = useState('light');
    const [language, setLanguage] = useState('en');
    const [notice, setNotice] = useState(null);
    const [missingFiles, setMissingFiles] = useState(() => new Map());
    const [profiles, setProfiles] = useState([]);
    const [activeProfile, setActiveProfile] = useState(null);
    const [showImportModal, setShowImportModal] = useState(false);
    const [importText, setImportText] = useState('');
    const [importMode, setImportMode] = useState('merge');
    const [importFileName, setImportFileName] = useState('');

    const updateMissingFile = (taskId, status) => {
        setMissingFiles((prev) => {
            const next = new Map(prev);
            if (status) {
                next.set(taskId, status);
            } else {
                next.delete(taskId);
            }
            return next;
        });
    };

    const checkTaskFileStatus = async (task) => {
        if (!task || task.status !== "Success") {
            return;
        }
        try {
            const status = await GetTaskFileStatus(task.id);
            if (status === "missing") {
                updateMissingFile(task.id, "missing");
            } else if (status === "pending") {
                updateMissingFile(task.id, "pending");
            } else {
                updateMissingFile(task.id, '');
            }
        } catch {
        }
    };

    const refreshMissingStatuses = (items) => {
        if (!items || items.length === 0) {
            return;
        }
        items.forEach((task) => {
            void checkTaskFileStatus(task);
        });
    };

    useEffect(() => {
        let mounted = true;
        const storedTheme = localStorage.getItem('fetchforge-theme');
        const storedLanguage = localStorage.getItem('fetchforge-language');
        if (storedTheme) {
            setTheme(storedTheme);
        }
        if (storedLanguage) {
            setLanguage(storedLanguage);
        } else if (navigator.language?.startsWith('zh')) {
            setLanguage('zh');
        }
        document.documentElement.dataset.theme = storedTheme || theme;
        ListProfiles()
            .then((items) => {
                if (mounted) {
                    setProfiles(items || []);
                }
            })
            .catch(() => {});
        GetActiveProfile()
            .then((profile) => {
                if (mounted) {
                    setActiveProfile(profile);
                }
            })
            .catch(() => {});
        ListTasks()
            .then((items) => {
                if (mounted) {
                    setTasks(items || []);
                    refreshMissingStatuses(items || []);
                }
            })
            .catch(() => {});

        const handler = (task) => {
            setTasks((prev) => {
                const index = prev.findIndex((item) => item.id === task.id);
                if (index === -1) {
                    return [...prev, task];
                }
                const next = [...prev];
                next[index] = task;
                refreshMissingStatuses([task]);
                return next;
            });
        };

        EventsOn("task:update", handler);
        return () => {
            mounted = false;
            EventsOff("task:update", handler);
        };
    }, []);

    useEffect(() => {
        document.documentElement.dataset.theme = theme;
        localStorage.setItem('fetchforge-theme', theme);
    }, [theme]);

    useEffect(() => {
        localStorage.setItem('fetchforge-language', language);
    }, [language]);

    useEffect(() => () => {}, []);

    const handleDownload = async () => {
        if (!inputText.trim()) {
            return;
        }
        const textToSubmit = inputText;
        setInputText('');
        try {
            const created = await CreateTasksFromText(textToSubmit);
            if (created && created.length) {
                setTasks((prev) => {
                    const known = new Set(prev.map((task) => task.id));
                    const merged = [...prev];
                    created.forEach((task) => {
                        if (!known.has(task.id)) {
                            merged.push(task);
                        }
                    });
                    return merged;
                });
            }
        } catch {
        }
    };

    const handleInputKeyDown = (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            handleDownload();
        }
    };

    const handleDeleteTask = async (taskId) => {
        try {
            await DeleteTask(taskId);
            setTasks((prev) => prev.filter((task) => task.id !== taskId));
        } catch (err) {
            showNotice(resolveErrorMessage(err));
        }
    };

    const handleOpenFolder = async (taskId) => {
        try {
            await OpenTaskFolder(taskId);
        } catch (err) {
            showNotice(resolveErrorMessage(err));
        }
    };

    const handleOpenFile = async (taskId) => {
        try {
            const status = await GetTaskFileStatus(taskId);
            if (status === "pending") {
                updateMissingFile(taskId, "pending");
                return;
            }
            if (status === "missing") {
                updateMissingFile(taskId, "missing");
                return;
            }
            updateMissingFile(taskId, '');
            await OpenTaskFile(taskId);
        } catch (err) {
            const message = resolveErrorMessage(err);
            if (isMissingFileError(message)) {
                updateMissingFile(taskId, message === dictionary.errors.outputMissing ? "pending" : "missing");
                return;
            }
            showNotice(message);
        }
    };

    const handleProfileChange = async (event) => {
        const nextId = event.target.value;
        try {
            await SetActiveProfile(nextId);
            const next = profiles.find((profile) => profile.id === nextId);
            setActiveProfile(next || null);
        } catch (err) {
            showNotice(resolveErrorMessage(err));
        }
    };

    const handleExport = async () => {
        try {
            const path = await ExportTasksToFile();
            showNotice(`${dictionary.noticeExport} ${path}`, {
                actionLabel: dictionary.noticeOpenFolder,
                onAction: () => OpenPath(path)
            });
        } catch (err) {
            showNotice(resolveErrorMessage(err));
        }
    };

    const handleImport = async () => {
        try {
            await ImportTasks(importText, importMode);
            const items = await ListTasks();
            setTasks(items || []);
            refreshMissingStatuses(items || []);
            setImportText('');
            setImportFileName('');
            setShowImportModal(false);
            showNotice(dictionary.noticeImport);
        } catch (err) {
            showNotice(resolveErrorMessage(err));
        }
    };

    const handleImportFileChange = (event) => {
        const file = event.target.files?.[0];
        if (!file) {
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result;
            if (typeof result === "string") {
                setImportText(result);
                setImportFileName(file.name);
            }
        };
        reader.readAsText(file);
    };

    const handleOpenURL = (url) => {
        if (!url) {
            return;
        }
        try {
            BrowserOpenURL(url);
        } catch {
        }
    };

    const getDisplayTitle = (task) => {
        const title = task?.title?.trim();
        if (title && title !== "Pending title" && !/^\d+$/.test(title)) {
            return task.title;
        }
        if (task?.outputPath) {
            const parts = task.outputPath.split(/[/\\]/);
            const filename = parts[parts.length - 1] || "";
            const trimmed = filename.replace(/\.[^/.]+$/, "");
            if (trimmed) {
                return trimmed;
            }
        }
        if (task?.url) {
            try {
                const parsed = new URL(task.url);
                const host = parsed.hostname.replace(/^www\./, "");
                if (host) {
                    return host;
                }
            } catch {
            }
        }
        return title || "Untitled";
    };

    const dictionary = copy[language] || copy.en;
    const getStatusLabel = (status) => dictionary.status[status] || status;
    const showNotice = (message, options = {}) => {
        if (!message) {
            return;
        }
        setNotice({
            message,
            actionLabel: options.actionLabel || '',
            onAction: options.onAction || null
        });
    };

    const resolveErrorMessage = (err) => {
        const raw =
            err?.message ??
            err?.error ??
            err?.errorMessage ??
            err ??
            '';
        const message = String(raw);
        if (!message) {
            return '';
        }
        const lower = message.toLowerCase();
        if (lower.includes('file not found') || lower.includes('no such file')) {
            return dictionary.errors.fileNotFound;
        }
        if (lower.includes('output file not available')) {
            return dictionary.errors.outputMissing;
        }
        return message;
    };

    const isMissingFileError = (message) => {
        if (!message) {
            return false;
        }
        return message === dictionary.errors.fileNotFound || message === dictionary.errors.outputMissing;
    };

    const getMissingMessage = (task) => {
        const status = missingFiles.get(task.id);
        if (status === "pending") {
            return dictionary.errors.outputMissing;
        }
        if (status === "missing") {
            return dictionary.errors.fileNotFound;
        }
        if (task?.missingOutput) {
            return dictionary.errors.fileNotFound;
        }
        return '';
    };

    const getProgressLabel = (task) => {
        if (task?.status !== "Running") {
            return '';
        }
        if (!task?.progress) {
            return '';
        }
        const match = String(task.progress).match(/(\d+(\.\d+)?)/);
        if (!match) {
            return '';
        }
        const value = Number(match[1]);
        if (Number.isNaN(value) || value >= 100) {
            return '';
        }
        return `${Math.max(0, Math.round(value))}%`;
    };

    const formatDuration = (seconds) => {
        const value = Number(seconds);
        if (!value || Number.isNaN(value) || value <= 0) {
            return '';
        }
        const total = Math.floor(value);
        const hrs = Math.floor(total / 3600);
        const mins = Math.floor((total % 3600) / 60);
        const secs = total % 60;
        if (hrs > 0) {
            return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        }
        return `${mins}:${String(secs).padStart(2, '0')}`;
    };

    const formatBytes = (bytes) => {
        const value = Number(bytes);
        if (!value || Number.isNaN(value) || value <= 0) {
            return '';
        }
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = value;
        let unitIndex = 0;
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex += 1;
        }
        const precision = size >= 10 || unitIndex === 0 ? 0 : 1;
        return `${size.toFixed(precision)} ${units[unitIndex]}`;
    };

    const formatResolution = (task) => {
        const width = Number(task?.width || 0);
        const height = Number(task?.height || 0);
        if (Number.isNaN(width) || Number.isNaN(height)) {
            return '';
        }
        if (width > 0 && height > 0) {
            return `${width}x${height}`;
        }
        if (height > 0) {
            return `${height}p`;
        }
        return '';
    };

    const getMetaItems = (task) => {
        const items = [];
        const duration = formatDuration(task?.duration);
        if (duration) {
            items.push({label: dictionary.meta.duration, value: duration});
        }
        const size = formatBytes(task?.filesize);
        if (size) {
            items.push({label: dictionary.meta.size, value: size});
        }
        const resolution = formatResolution(task);
        if (resolution) {
            items.push({label: dictionary.meta.resolution, value: resolution});
        }
        return items;
    };

    const getInlineMetaItems = (task) => {
        const items = [];
        const duration = formatDuration(task?.duration);
        if (duration) {
            items.push({label: dictionary.meta.duration, value: duration});
        }
        const resolution = formatResolution(task);
        if (resolution) {
            items.push({label: dictionary.meta.resolution, value: resolution});
        }
        const size = formatBytes(task?.filesize);
        if (size) {
            items.push({label: dictionary.meta.size, value: size});
        }
        if (task?.sourceHost) {
            items.push({label: dictionary.meta.source, value: task.sourceHost});
        }
        return items;
    };

    const PlayIcon = () => (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M8 5l11 7-11 7V5z" fill="currentColor" />
        </svg>
    );

    const TrashIcon = () => (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
                d="M4 7h16M9 3h6l1 2H8l1-2zm1 6v8m4-8v8m3-8v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );

    const getTaskTime = (task) => {
        const value = task?.createdAt || task?.updatedAt;
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            return 0;
        }
        return parsed.getTime();
    };

    const sortedTasks = [...tasks].sort((a, b) => {
        const rankA = a.status === "Running" ? 0 : 1;
        const rankB = b.status === "Running" ? 0 : 1;
        if (rankA !== rankB) {
            return rankA - rankB;
        }
        return getTaskTime(b) - getTaskTime(a);
    });

    return (
        <div className="app-shell">
            <header className="header">
                <div className="header-inner">
                    <div className="title-row">
                        <div className="title">FetchForge</div>
                        <div className="header-actions">
                            <button
                                className="btn-tertiary"
                                type="button"
                                onClick={handleExport}
                            >
                                {dictionary.export}
                            </button>
                            <button
                                className="btn-tertiary"
                                type="button"
                                onClick={() => setShowImportModal(true)}
                            >
                                {dictionary.import}
                            </button>
                            <button
                                className="btn-tertiary"
                                type="button"
                                onClick={() => setLanguage(language === 'en' ? 'zh' : 'en')}
                            >
                                {dictionary.language}
                            </button>
                            <button
                                className="btn-tertiary"
                                type="button"
                                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                            >
                                {theme === 'dark' ? dictionary.lightTheme : dictionary.darkTheme}
                            </button>
                        </div>
                    </div>
                    <div className="subtitle">{dictionary.subtitle}</div>
                {notice ? (
                    <div className="notice" role="status">
                        <span className="notice-text">{notice.message}</span>
                        <div className="notice-actions">
                            {notice.actionLabel && notice.onAction ? (
                                <button
                                    className="btn-tertiary"
                                    type="button"
                                    onClick={notice.onAction}
                                >
                                    {notice.actionLabel}
                                </button>
                            ) : null}
                            <button
                                className="btn-tertiary"
                                type="button"
                                onClick={() => setNotice(null)}
                            >
                                {dictionary.noticeClose}
                            </button>
                        </div>
                    </div>
                ) : null}
                </div>
            </header>
            <div className="app">
            <section className="input-panel">
                <label className="label" htmlFor="url-input">{dictionary.urlsLabel}</label>
                <textarea
                    id="url-input"
                    className="textarea"
                    placeholder={dictionary.urlsPlaceholder}
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={handleInputKeyDown}
                    rows={6}
                />
                <div className="hint">{dictionary.tip}</div>
                <div className="actions">
                    <div className="profile-control">
                        <span className="profile-label">{dictionary.profile}</span>
                        <select
                            className="profile-select"
                            value={activeProfile?.id || defaultProfileID}
                            onChange={handleProfileChange}
                        >
                            {profiles.map((profile) => (
                                <option key={profile.id} value={profile.id}>
                                    {profile.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <button className="btn" onClick={handleDownload}>{dictionary.download}</button>
                </div>
            </section>
            <section className="task-panel">
                    <div className="panel-title">{dictionary.tasks}</div>
                {tasks.length === 0 ? (
                    <div className="empty-state">{dictionary.empty}</div>
                ) : (
                    <div className="task-list">
                        {sortedTasks.map((task) => (
                            <div key={task.id} className={`task-card status-${task.status?.toLowerCase()}`}>
                                <div className="task-row">
                                    <button
                                        className="title-link"
                                        type="button"
                                        onClick={() => handleOpenURL(task.url)}
                                    >
                                        {getDisplayTitle(task)}
                                    </button>
                                    <div className="task-actions">
                                        <div className="task-status">
                                            <span className="status-text">{getStatusLabel(task.status)}</span>
                                            {getProgressLabel(task) ? (
                                                <span className="status-badge">{getProgressLabel(task)}</span>
                                            ) : null}
                                        </div>
                                        {task.status === "Success" ? (
                                            <button
                                                className="btn-tertiary icon-btn"
                                                type="button"
                                                onClick={() => handleOpenFile(task.id)}
                                                disabled={missingFiles.has(task.id)}
                                                aria-label={dictionary.play}
                                                title={dictionary.play}
                                            >
                                                <PlayIcon />
                                            </button>
                                        ) : null}
                                        <button
                                            className="btn-tertiary icon-btn"
                                            type="button"
                                            onClick={() => handleDeleteTask(task.id)}
                                            aria-label={dictionary.delete}
                                            title={dictionary.delete}
                                        >
                                            <TrashIcon />
                                        </button>
                                    </div>
                                </div>
                                <div className="task-time-row">
                                    <div className="task-time">
                                        {formatDateTime(
                                            task.status === "Success" || task.status === "Failed"
                                                ? task.updatedAt
                                                : task.createdAt
                                        )}
                                    </div>
                                    {getInlineMetaItems(task).length ? (
                                        <div className="task-inline-meta">
                                            {getInlineMetaItems(task).map((item) => (
                                                <span key={item.label} className="meta-inline-item">
                                                    <span className="meta-inline-label">{item.label}</span>
                                                    <span className="meta-inline-value">{item.value}</span>
                                                </span>
                                            ))}
                                        </div>
                                    ) : null}
                                    {getMissingMessage(task) ? (
                                        <div className="task-warning">{getMissingMessage(task)}</div>
                                    ) : null}
                                </div>
                                {task.status === "Failed" && task.errorMessage ? (
                                    <div className="task-error">{task.errorMessage}</div>
                                ) : null}
                                {task.status === "Success" ? (
                                    <button className="btn-secondary" onClick={() => handleOpenFolder(task.id)}>
                                        {dictionary.openFolder}
                                    </button>
                                ) : null}
                            </div>
                        ))}
                    </div>
                )}
            </section>
            {showImportModal ? (
                <div className="modal-overlay" role="dialog" aria-modal="true">
                    <div className="modal-card">
                        <div className="modal-title">{dictionary.importTitle}</div>
                        <div className="modal-hint">{dictionary.importHint}</div>
                        <div className="modal-file">
                            <button
                                className="btn-tertiary"
                                type="button"
                                onClick={() => document.getElementById("import-file")?.click()}
                            >
                                {dictionary.importPickFile}
                            </button>
                            <span className="modal-file-name">{importFileName || "JSON"}</span>
                            <input
                                id="import-file"
                                className="modal-file-input"
                                type="file"
                                accept=".json,application/json"
                                onChange={handleImportFileChange}
                            />
                        </div>
                        <textarea
                            className="modal-textarea"
                            rows={8}
                            value={importText}
                            onChange={(e) => setImportText(e.target.value)}
                            placeholder='[{"id":"...","url":"..."}]'
                        />
                        <div className="modal-actions">
                            <select
                                className="profile-select"
                                value={importMode}
                                onChange={(e) => setImportMode(e.target.value)}
                            >
                                <option value="merge">merge</option>
                                <option value="replace">replace</option>
                            </select>
                            <div className="modal-buttons">
                                <button className="btn-secondary" onClick={() => setShowImportModal(false)}>
                                    {dictionary.importCancel}
                                </button>
                                <button className="btn" onClick={handleImport}>
                                    {dictionary.importConfirm}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}
            </div>
        </div>
    )
}

export default App
