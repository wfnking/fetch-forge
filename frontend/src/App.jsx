import {useEffect, useState} from 'react';
import {
    CreateTasksFromText,
    DeleteTask,
    ExportTasksToFile,
    GetActiveProfile,
    GetTaskFileStatus,
    GetTaskResumeStatus,
    GetUseBrowserCookies,
    ImportTasks,
    ListProfiles,
    ListTasks,
    OpenPath,
    OpenTaskFile,
    OpenTaskFolder,
    ResumeTask,
    SetUseBrowserCookies,
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

const trimTitleSuffix = (value) => {
    if (!value) {
        return "";
    }
    return value.replace(/\s*\(\d+\)\s*$/, "").trim();
};

const copy = {
    en: {
        subtitle: "Paste URLs, process in batches, own the pipeline.",
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
        speed: "Speed",
        eta: "ETA",
        downloading: "Downloading",
        preparing: "Preparing",
        finalizing: "Finalizing",
        play: "Play",
        profile: "Profile",
        export: "Export",
        import: "Import",
        importTitle: "Import Tasks",
        importHint: "Paste JSON to import. Merge keeps local tasks, replace overwrites.",
        importConfirm: "Import",
        importCancel: "Cancel",
        importPickFile: "Choose file",
        importOverwrite: "Overwrite downloaded (requeue)",
        resume: "Continue",
        noticeExport: "Exported to",
        useBrowserCookies: "Use browser cookies",
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
        subtitle: "批量粘贴链接，建立你的下载流水线。",
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
        speed: "速度",
        eta: "剩余",
        downloading: "下载中",
        preparing: "准备中",
        finalizing: "整理中",
        play: "播放",
        profile: "模式",
        export: "导出",
        import: "导入",
        importTitle: "导入任务",
        importHint: "粘贴 JSON 进行导入。合并保留本地任务，替换会覆盖。",
        importConfirm: "确认导入",
        importCancel: "取消",
        importPickFile: "选择文件",
        importOverwrite: "覆盖已下载并重新入队",
        resume: "继续下载",
        noticeExport: "已导出到",
        useBrowserCookies: "使用浏览器 Cookie",
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
    const [language, setLanguage] = useState('zh');
    const [notice, setNotice] = useState(null);
    const [missingFiles, setMissingFiles] = useState(() => new Map());
    const [resumeCandidates, setResumeCandidates] = useState(() => new Map());
    const [profiles, setProfiles] = useState([]);
    const [activeProfile, setActiveProfile] = useState(null);
    const [showImportModal, setShowImportModal] = useState(false);
    const [importText, setImportText] = useState('');
    const [importMode, setImportMode] = useState('merge');
    const [importFileName, setImportFileName] = useState('');
    const [overwriteDownloaded, setOverwriteDownloaded] = useState(false);
    const [useBrowserCookies, setUseBrowserCookies] = useState(false);

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

    const updateResumeStatus = (taskId, status) => {
        setResumeCandidates((prev) => {
            const next = new Map(prev);
            if (status) {
                next.set(taskId, status);
            } else {
                next.delete(taskId);
            }
            return next;
        });
    };

    const checkTaskResumeStatus = async (task) => {
        if (!task || task.status === "Success") {
            if (task?.id) {
                updateResumeStatus(task.id, '');
            }
            return;
        }
        try {
            const status = await GetTaskResumeStatus(task.id);
            if (status === "ready") {
                updateResumeStatus(task.id, "ready");
            } else {
                updateResumeStatus(task.id, '');
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
            void checkTaskResumeStatus(task);
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
        } else {
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
        GetUseBrowserCookies()
            .then((enabled) => {
                if (mounted) {
                    setUseBrowserCookies(Boolean(enabled));
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

    const handleResumeTask = async (taskId) => {
        try {
            await ResumeTask(taskId);
            updateResumeStatus(taskId, '');
        } catch (err) {
            showNotice(resolveErrorMessage(err));
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

    const handleCookieToggle = async (event) => {
        const enabled = event.target.checked;
        setUseBrowserCookies(enabled);
        try {
            await SetUseBrowserCookies(enabled);
        } catch (err) {
            setUseBrowserCookies((prev) => !prev);
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
            await ImportTasks(importText, importMode, overwriteDownloaded);
            const items = await ListTasks();
            setTasks(items || []);
            refreshMissingStatuses(items || []);
            setImportText('');
            setImportFileName('');
            setOverwriteDownloaded(false);
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
        const title = trimTitleSuffix(task?.title?.trim());
        if (title && title !== "Pending title" && !/^\d+$/.test(title)) {
            return title;
        }
        if (task?.outputPath) {
            const parts = task.outputPath.split(/[/\\]/);
            const filename = parts[parts.length - 1] || "";
            const trimmed = filename.replace(/\.[^/.]+$/, "");
            if (trimmed) {
                return trimTitleSuffix(trimmed);
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
    const getStatusClass = (status) => {
        if (status === "Running") {
            return "bg-[var(--status-running)] text-[var(--status-text)]";
        }
        if (status === "Success") {
            return "bg-[var(--status-success)] text-[var(--status-success-text)]";
        }
        if (status === "Failed") {
            return "bg-[var(--status-failed)] text-[var(--status-failed-text)]";
        }
        return "bg-[var(--status-bg)] text-[var(--status-text)]";
    };
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
        if (task?.status === "Success") {
            return '';
        }
        if (task?.missingOutput) {
            return dictionary.errors.fileNotFound;
        }
        return '';
    };

    const getProgressValue = (task) => {
        if (task?.status !== "Running") {
            return null;
        }
        const value = parseProgress(task?.progress);
        if (!value || value >= 100) {
            return null;
        }
        return Math.max(0, Math.round(value));
    };

    const getRunningLabel = (task, progressValue) => {
        const stage = String(task?.stage || '').toLowerCase();
        if (stage.includes('finalize')) {
            return dictionary.finalizing;
        }
        if (progressValue === null) {
            return dictionary.preparing;
        }
        if (stage.includes('resolve') || stage.includes('parse')) {
            return dictionary.preparing;
        }
        return dictionary.downloading;
    };

    const normalizeProgressMeta = (value) => {
        if (!value) {
            return '';
        }
        const trimmed = String(value).trim();
        if (!trimmed || trimmed === "N/A" || trimmed === "NA" || trimmed === "Unknown") {
            return '';
        }
        return trimmed;
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
        <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M8 5l11 7-11 7V5z" fill="currentColor" />
        </svg>
    );

    const TrashIcon = () => (
        <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
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

    const CloseIcon = () => (
        <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
                d="M6 6l12 12M6 18L18 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
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
        <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
            <header className="sticky top-0 z-10 border-b border-[var(--panel-border)] bg-[var(--header-bg)] backdrop-blur">
                <div className="mx-auto w-full max-w-[1120px] px-6 pt-4 pb-3">
                    <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-4">
                        <div className="text-[32px] font-bold tracking-[0.5px]">FetchForge</div>
                        <div className="inline-flex flex-1 flex-wrap items-center justify-end gap-2">
                            <button
                                className="cursor-pointer rounded-lg border border-[var(--button-border)] px-2.5 py-1 text-[11px] uppercase tracking-[0.4px] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--button-border-hover)]"
                                type="button"
                                onClick={handleExport}
                            >
                                {dictionary.export}
                            </button>
                            <button
                                className="cursor-pointer rounded-lg border border-[var(--button-border)] px-2.5 py-1 text-[11px] uppercase tracking-[0.4px] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--button-border-hover)]"
                                type="button"
                                onClick={() => setShowImportModal(true)}
                            >
                                {dictionary.import}
                            </button>
                            <button
                                className="cursor-pointer rounded-lg border border-[var(--button-border)] px-2.5 py-1 text-[11px] uppercase tracking-[0.4px] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--button-border-hover)]"
                                type="button"
                                onClick={() => setLanguage(language === 'en' ? 'zh' : 'en')}
                            >
                                {dictionary.language}
                            </button>
                            <button
                                className="cursor-pointer rounded-lg border border-[var(--button-border)] px-2.5 py-1 text-[11px] uppercase tracking-[0.4px] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--button-border-hover)]"
                                type="button"
                                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                            >
                                {theme === 'dark' ? dictionary.lightTheme : dictionary.darkTheme}
                            </button>
                        </div>
                    </div>
                    <div className="mt-1.5 text-[14px] text-[var(--muted)]">{dictionary.subtitle}</div>
                    {notice ? (
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--notice-border)] bg-[var(--notice-bg)] px-3 py-2 text-left text-[12px] text-[var(--notice-text)]">
                            <span className="break-words">{notice.message}</span>
                            <div className="inline-flex flex-wrap items-center gap-2">
                                {notice.actionLabel && notice.onAction ? (
                                    <button
                                        className="cursor-pointer rounded-lg border border-[var(--button-border)] px-2.5 py-1 text-[11px] uppercase tracking-[0.4px] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--button-border-hover)]"
                                        type="button"
                                        onClick={notice.onAction}
                                    >
                                        {notice.actionLabel}
                                    </button>
                                ) : null}
                                <button
                                    className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-red-300/40 text-red-400 hover:border-red-300 hover:text-red-300"
                                    type="button"
                                    onClick={() => setNotice(null)}
                                    aria-label={dictionary.noticeClose}
                                    title={dictionary.noticeClose}
                                >
                                    <CloseIcon />
                                </button>
                            </div>
                        </div>
                    ) : null}
                </div>
            </header>
            <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-6 py-8">
                <section className="rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] p-5 text-left shadow-[0_14px_30px_var(--shadow)]">
                    <label className="text-[12px] uppercase tracking-[0.5px] text-[var(--muted)]" htmlFor="url-input">
                        {dictionary.urlsLabel}
                    </label>
                    <textarea
                        id="url-input"
                        className="mt-2.5 w-full resize-none rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] p-3 text-[14px] leading-[1.4] text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--input-border-focus)]"
                        placeholder={dictionary.urlsPlaceholder}
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        onKeyDown={handleInputKeyDown}
                        rows={6}
                    />
                    <div className="mt-2 text-[12px] text-[var(--muted)]">{dictionary.tip}</div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-3 text-[12px] text-[var(--muted)]">
                            <div className="inline-flex items-center gap-2">
                                <span className="text-[10px] uppercase tracking-[0.4px]">{dictionary.profile}</span>
                                <select
                                    className="h-9 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-[12px] text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--input-border-focus)]"
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
                            <label className="inline-flex items-center gap-2 rounded-full border border-[var(--button-border)] px-3 py-1.5 text-[11px] uppercase tracking-[0.35px] text-[var(--muted)]">
                                <input
                                    type="checkbox"
                                    className="h-4 w-4 accent-[var(--accent)]"
                                    checked={useBrowserCookies}
                                    onChange={handleCookieToggle}
                                />
                                {dictionary.useBrowserCookies}
                            </label>
                        </div>
                        <button
                            className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-[var(--accent)] px-4 py-2 font-semibold text-[var(--accent-text)] shadow-sm transition hover:shadow-[0_8px_16px_rgba(0,0,0,0.2)]"
                            onClick={handleDownload}
                        >
                            {dictionary.download}
                        </button>
                    </div>
                </section>
                <section className="rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] p-5 text-left shadow-[0_14px_30px_var(--shadow)]">
                    <div className="mb-3 text-[16px] font-semibold">{dictionary.tasks}</div>
                    {tasks.length === 0 ? (
                        <div className="text-[13px] text-[var(--muted)]">{dictionary.empty}</div>
                    ) : (
                        <div className="flex flex-col gap-3">
                            {sortedTasks.map((task) => (
                                <div key={task.id} className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-3">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <button
                                            className="text-left text-[14px] font-semibold text-[var(--text)] hover:text-[var(--title-hover)] hover:underline hover:underline-offset-4"
                                            type="button"
                                            onClick={() => handleOpenURL(task.url)}
                                        >
                                            {getDisplayTitle(task)}
                                        </button>
                                        <div className="inline-flex items-center gap-2">
                                            {task.status !== "Running" ? (
                                                <div className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] uppercase tracking-[0.4px] ${getStatusClass(task.status)}`}>
                                                    <span className="text-[11px]">{getStatusLabel(task.status)}</span>
                                                </div>
                                            ) : null}
                                            {(() => {
                                                if (task.status !== "Running") {
                                                    return null;
                                                }
                                                const progressValue = getProgressValue(task);
                                                const label = getRunningLabel(task, progressValue);
                                                const speed = normalizeProgressMeta(task?.speed);
                                                const eta = normalizeProgressMeta(task?.eta);
                                                return (
                                                    <div className="inline-flex items-center gap-2 rounded-lg border border-[var(--progress-border)] bg-[var(--progress-bg)] px-2 py-1 text-[11px] uppercase tracking-[0.3px] text-[var(--progress-text)]">
                                                        <span className="text-[10px] text-[var(--muted)]">{label}</span>
                                                        {progressValue !== null ? (
                                                            <>
                                                                <span className="text-[12px] tabular-nums text-[var(--progress-text-strong)]">
                                                                    {progressValue}%
                                                                </span>
                                                                <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[var(--progress-track)]">
                                                                    <div
                                                                        className="h-full rounded-full transition-[width] duration-300"
                                                                        style={{width: `${progressValue}%`, background: "var(--progress-fill)"}}
                                                                    />
                                                                </div>
                                                            </>
                                                        ) : (
                                                            <div className="progress-indeterminate h-1.5 w-20 overflow-hidden rounded-full bg-[var(--progress-track)]">
                                                                <div className="progress-indeterminate__bar h-full rounded-full" />
                                                            </div>
                                                        )}
                                                        {speed ? (
                                                            <span className="text-[10px] tabular-nums text-[var(--progress-text)]">
                                                                {dictionary.speed} {speed}
                                                            </span>
                                                        ) : null}
                                                        {eta ? (
                                                            <span className="text-[10px] tabular-nums text-[var(--progress-text)]">
                                                                {dictionary.eta} {eta}
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                );
                                            })()}
                                            {task.status === "Success" ? (
                                                <button
                                                    className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-[var(--button-border)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--button-border-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                                                    type="button"
                                                    onClick={() => handleOpenFile(task.id)}
                                                    disabled={missingFiles.has(task.id)}
                                                    aria-label={dictionary.play}
                                                    title={dictionary.play}
                                                >
                                                    <PlayIcon />
                                                </button>
                                            ) : null}
                                            {task.status !== "Success" && resumeCandidates.has(task.id) ? (
                                                <button
                                                    className="inline-flex h-8 cursor-pointer items-center justify-center rounded-lg border border-[var(--button-border)] px-2 text-[11px] uppercase tracking-[0.4px] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--button-border-hover)]"
                                                    type="button"
                                                    onClick={() => handleResumeTask(task.id)}
                                                >
                                                    {dictionary.resume}
                                                </button>
                                            ) : null}
                                            <button
                                                className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-[var(--button-border)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--button-border-hover)]"
                                                type="button"
                                                onClick={() => handleDeleteTask(task.id)}
                                                aria-label={dictionary.delete}
                                                title={dictionary.delete}
                                            >
                                                <TrashIcon />
                                            </button>
                                        </div>
                                    </div>
                                    <div className="mt-1.5 flex flex-wrap items-baseline gap-2.5">
                                        <div className="text-[12px] text-[var(--muted)] tabular-nums tracking-[0.2px]">
                                            {formatDateTime(
                                                task.status === "Success" || task.status === "Failed"
                                                    ? task.updatedAt
                                                    : task.createdAt
                                            )}
                                        </div>
                                        {getInlineMetaItems(task).length ? (
                                            <div className="inline-flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-[var(--muted)] tracking-[0.2px]">
                                                {getInlineMetaItems(task).map((item) => (
                                                    <span key={item.label} className="inline-flex items-baseline gap-1.5">
                                                        <span className="text-[10px] uppercase tracking-[0.35px] text-[var(--muted-strong)]">{item.label}</span>
                                                        <span>{item.value}</span>
                                                    </span>
                                                ))}
                                            </div>
                                        ) : null}
                                        {getMissingMessage(task) ? (
                                            <div className="text-[12px] text-[var(--warning)]">{getMissingMessage(task)}</div>
                                        ) : null}
                                    </div>
                                    {task.status === "Failed" && task.errorMessage ? (
                                        <div className="mt-1.5 text-[12px] text-[var(--error)]">{task.errorMessage}</div>
                                    ) : null}
                                    {task.status === "Success" ? (
                                    <button
                                        className="mt-2 inline-flex h-9 cursor-pointer items-center justify-center rounded-lg border border-[var(--button-border)] bg-[var(--button-bg)] px-3 text-[12px] uppercase tracking-[0.4px] text-[var(--text)] hover:bg-[var(--button-bg-hover)]"
                                        onClick={() => handleOpenFolder(task.id)}
                                    >
                                        {dictionary.openFolder}
                                    </button>
                                    ) : null}
                                </div>
                            ))}
                        </div>
                    )}
                </section>
                {showImportModal ? (
                    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-5" role="dialog" aria-modal="true">
                        <div className="w-full max-w-[640px] rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] p-4 text-left shadow-[0_20px_40px_var(--shadow)]">
                            <div className="text-[16px] font-semibold">{dictionary.importTitle}</div>
                            <div className="mt-1.5 text-[12px] text-[var(--muted)]">{dictionary.importHint}</div>
                            <div className="mt-3 flex flex-wrap items-center gap-2.5">
                                <button
                                    className="cursor-pointer rounded-lg border border-[var(--button-border)] px-2.5 py-1 text-[11px] uppercase tracking-[0.4px] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--button-border-hover)]"
                                    type="button"
                                    onClick={() => document.getElementById("import-file")?.click()}
                                >
                                    {dictionary.importPickFile}
                                </button>
                                <span className="text-[12px] text-[var(--muted)]">{importFileName || "JSON"}</span>
                                <input
                                    id="import-file"
                                    className="hidden"
                                    type="file"
                                    accept=".json,application/json"
                                    onChange={handleImportFileChange}
                                />
                            </div>
                            <textarea
                                className="mt-3 w-full resize-none rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] p-3 text-[12px] leading-[1.5] text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--input-border-focus)] font-mono"
                                rows={8}
                                value={importText}
                                onChange={(e) => setImportText(e.target.value)}
                                placeholder='[{"id":"...","url":"..."}]'
                            />
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                                <select
                                    className="h-9 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-[12px] text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--input-border-focus)]"
                                    value={importMode}
                                    onChange={(e) => setImportMode(e.target.value)}
                                >
                                    <option value="merge">merge</option>
                                    <option value="replace">replace</option>
                                </select>
                                <label className="inline-flex cursor-pointer items-center gap-2 text-[12px] text-[var(--muted)]">
                                    <input
                                        type="checkbox"
                                        className="h-4 w-4 accent-[var(--accent)]"
                                        checked={overwriteDownloaded}
                                        onChange={(e) => setOverwriteDownloaded(e.target.checked)}
                                    />
                                    {dictionary.importOverwrite}
                                </label>
                                <div className="inline-flex items-center gap-2">
                                    <button
                                        className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg border border-[var(--button-border)] bg-[var(--button-bg)] px-3 text-[12px] uppercase tracking-[0.4px] text-[var(--text)] hover:bg-[var(--button-bg-hover)]"
                                        onClick={() => setShowImportModal(false)}
                                    >
                                        {dictionary.importCancel}
                                    </button>
                                    <button
                                        className="inline-flex h-9 cursor-pointer items-center justify-center rounded-lg bg-[var(--accent)] px-3 text-[12px] font-semibold text-[var(--accent-text)] shadow-sm transition hover:shadow-[0_8px_16px_rgba(0,0,0,0.2)]"
                                        onClick={handleImport}
                                    >
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
