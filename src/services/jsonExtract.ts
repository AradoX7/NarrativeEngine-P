/**
 * Shared JSON extraction helper for LLM responses.
 * Handles think blocks, markdown fences, and truncated JSON recovery.
 * Supports both object ({…}) and array ([…]) root shapes.
 *
 * Returns { value, parseOk }:
 *   - parseOk: true  → parsed successfully (possibly via truncation recovery)
 *   - parseOk: false → unrecoverable; value is the caller-supplied fallback
 */
export function extractJsonRobust<T>(raw: string, fallback: T): { value: T; parseOk: boolean } {
    let clean = raw.replace(/<think[\s\S]*?<\/think>/gi, '');
    const mdMatch = clean.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (mdMatch) clean = mdMatch[1];

    const openBrace = clean.indexOf('{');
    const openBracket = clean.indexOf('[');

    let rootClose: string;
    let start: number;
    if (openBrace === -1 && openBracket === -1) {
        return { value: fallback, parseOk: false };
    } else if (openBrace === -1) {
        rootClose = ']'; start = openBracket;
    } else if (openBracket === -1) {
        rootClose = '}'; start = openBrace;
    } else {
        const isArray = openBracket < openBrace;
        rootClose = isArray ? ']' : '}';
        start = isArray ? openBracket : openBrace;
    }

    let text = clean.slice(start);

    try {
        return { value: JSON.parse(text) as T, parseOk: true };
    } catch {
        // Truncated response — attempt recovery.
        let depth = 0;
        let inString = false;
        let escape = false;
        const candidates: { pos: number; depth: number }[] = [];
        let rootClosedAt = -1;

        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (escape) { escape = false; continue; }
            if (ch === '\\' && inString) { escape = true; continue; }
            if (ch === '"') { inString = !inString; continue; }
            if (inString) continue;
            if (ch === '{' || ch === '[') depth++;
            if (ch === '}' || ch === ']') {
                depth--;
                if (depth === 0) {
                    rootClosedAt = i;
                    break;
                }
                candidates.push({ pos: i, depth });
            }
            if (ch === ',' && depth === 1) {
                candidates.push({ pos: i - 1, depth });
            }
        }

        // Try 1: root-closed prefix is self-contained valid JSON
        if (rootClosedAt > 0) {
            try {
                return { value: JSON.parse(text.slice(0, rootClosedAt + 1)) as T, parseOk: true };
            } catch { /* fall through */ }
        }

        // Try 2: each candidate — truncate + close remaining open brackets
        for (let ci = candidates.length - 1; ci >= 0; ci--) {
            const { pos, depth: d } = candidates[ci];
            // Close brackets: we need '}' for every '{' and ']' for every '[' still open.
            // But we don't track whether each open bracket was { or [. Instead, we use
            // a simple heuristic: close with alternating }] pairs.
            // More accurately, re-scan the prefix to build the exact close sequence.
            let openBrackets: string[] = [];
            let inStr = false;
            let esc = false;
            for (let j = 0; j <= pos; j++) {
                const c = text[j];
                if (esc) { esc = false; continue; }
                if (c === '\\' && inStr) { esc = true; continue; }
                if (c === '"') { inStr = !inStr; continue; }
                if (inStr) continue;
                if (c === '{' || c === '[') openBrackets.push(c);
                if (c === '}' || c === ']') openBrackets.pop();
            }
            // openBrackets now holds all unclosed brackets at position pos
            const closeStr = openBrackets.reverse().map(b => b === '{' ? '}' : ']').join('');
            const recovered = text.slice(0, pos + 1) + closeStr;
            try {
                return { value: JSON.parse(recovered) as T, parseOk: true };
            } catch { /* try next candidate */ }
        }

        return { value: fallback, parseOk: false };
    }
}