const MAX_ENTRIES = 500;
const entries = [];

function push(level, category, message, data) {
    const entry = {
        ts: Date.now(),
        level,
        cat: category,
        msg: message,
        data: data || null
    };

    entries.push(entry);
    if (entries.length > MAX_ENTRIES) {
        entries.shift();
    }

    const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
    sink("[planning-poker][" + category + "] " + message, data || "");
}

export const log = {
    info(category, message, data) {
        push("info", category, message, data);
    },
    warn(category, message, data) {
        push("warn", category, message, data);
    },
    error(category, message, data) {
        push("error", category, message, data);
    },
    getEntries() {
        return entries.slice();
    },
    clear() {
        entries.length = 0;
    },
    dump() {
        const formatted = entries.map((entry) => ({
            time: new Date(entry.ts).toISOString(),
            level: entry.level,
            category: entry.cat,
            message: entry.msg,
            data: entry.data
        }));
        console.table(formatted);
    }
};
