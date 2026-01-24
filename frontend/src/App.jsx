import {useEffect, useState} from 'react';
import './App.css';
import {CreateTasksFromText, ListTasks} from "../wailsjs/go/main/App";
import {EventsOff, EventsOn} from "../wailsjs/runtime/runtime";

function App() {
    const [inputText, setInputText] = useState('');
    const [tasks, setTasks] = useState([]);

    useEffect(() => {
        let mounted = true;
        ListTasks()
            .then((items) => {
                if (mounted) {
                    setTasks(items || []);
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
                return next;
            });
        };

        EventsOn("task:update", handler);
        return () => {
            mounted = false;
            EventsOff("task:update", handler);
        };
    }, []);

    const handleDownload = async () => {
        if (!inputText.trim()) {
            return;
        }
        try {
            const created = await CreateTasksFromText(inputText);
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

    return (
        <div className="app">
            <header className="header">
                <div className="title">LuxDesk</div>
                <div className="subtitle">Paste URLs, download with Lux, track tasks live.</div>
            </header>
            <section className="input-panel">
                <label className="label" htmlFor="url-input">URLs</label>
                <textarea
                    id="url-input"
                    className="textarea"
                    placeholder="Paste one or multiple URLs, separated by spaces or newlines."
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    rows={6}
                />
                <div className="actions">
                    <button className="btn" onClick={handleDownload}>Download</button>
                </div>
            </section>
            <section className="task-panel">
                <div className="panel-title">Tasks</div>
                {tasks.length === 0 ? (
                    <div className="empty-state">No tasks yet.</div>
                ) : (
                    <div className="task-list">
                        {tasks.map((task) => (
                            <div key={task.id} className={`task-card status-${task.status?.toLowerCase()}`}>
                                <div className="task-row">
                                    <div className="task-title">{task.title || "Untitled"}</div>
                                    <div className="task-status">{task.status}</div>
                                </div>
                                <div className="task-url">{task.url}</div>
                                {task.outputPath ? (
                                    <div className="task-output">Saved to: {task.outputPath}</div>
                                ) : null}
                                {task.status === "Failed" && task.errorMessage ? (
                                    <div className="task-error">{task.errorMessage}</div>
                                ) : null}
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    )
}

export default App
