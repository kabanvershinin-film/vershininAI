const TASK_STORAGE_KEY = 'genai_provider_tasks_v1';

function canUseLocalStorage() {
    return typeof window !== 'undefined' && window.localStorage;
}

function canUseServerFileStore() {
    return typeof process !== 'undefined' && process.versions?.node && typeof process.getBuiltinModule === 'function';
}

function serverStorePath() {
    if (!canUseServerFileStore()) return null;
    return process.env.GENAI_TASK_STORE_PATH || '/tmp/.genai/tasks.json';
}

function safeJsonParse(value) {
    if (!value || typeof value !== 'string') return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function memoryStore() {
    if (!globalThis.__GENAI_TASK_STORE__) {
        globalThis.__GENAI_TASK_STORE__ = {};
    }
    return globalThis.__GENAI_TASK_STORE__;
}

function readServerTasks() {
    const filePath = serverStorePath();
    if (!filePath) return null;
    const fs = process.getBuiltinModule('fs');
    if (!fs.existsSync(filePath)) return {};
    return safeJsonParse(fs.readFileSync(filePath, 'utf8')) || {};
}

function writeServerTasks(tasks) {
    const filePath = serverStorePath();
    if (!filePath) return false;
    const fs = process.getBuiltinModule('fs');
    const path = process.getBuiltinModule('path');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(tasks, null, 2)}\n`, 'utf8');
    return true;
}

export function loadTasks() {
    if (canUseLocalStorage()) {
        return safeJsonParse(localStorage.getItem(TASK_STORAGE_KEY)) || {};
    }
    const serverTasks = readServerTasks();
    if (serverTasks) return serverTasks;
    return memoryStore();
}

export function saveTasks(tasks) {
    if (canUseLocalStorage()) {
        localStorage.setItem(TASK_STORAGE_KEY, JSON.stringify(tasks));
    } else if (writeServerTasks(tasks)) {
        return tasks;
    } else {
        globalThis.__GENAI_TASK_STORE__ = tasks;
    }
    return tasks;
}

export function createInternalTaskId(providerId) {
    return `task_${providerId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function upsertTask(record) {
    const tasks = loadTasks();
    tasks[record.internalTaskId] = {
        ...(tasks[record.internalTaskId] || {}),
        ...record,
        updatedAt: new Date().toISOString(),
    };
    saveTasks(tasks);
    return tasks[record.internalTaskId];
}

export function getTask(internalTaskId) {
    return loadTasks()[internalTaskId] || null;
}

export function getTaskProviderId(internalTaskId) {
    return getTask(internalTaskId)?.providerId || null;
}

export function findTaskByIdempotency(idempotencyKey, requestHash) {
    if (!idempotencyKey) return null;
    return Object.values(loadTasks()).find((task) => task.idempotencyKey === idempotencyKey && task.requestHash === requestHash) || null;
}
