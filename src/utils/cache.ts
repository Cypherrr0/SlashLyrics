import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CACHE_DIR = join(homedir(), '.slashlyrics', 'cache');
const MAX_ENTRIES = 500;
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function cacheKey(title: string, artist: string): string {
    return createHash('md5').update(`${title}\n${artist}`).digest('hex');
}

export async function getCached(title: string, artist: string): Promise<{ lrc: string; tlrc?: string } | null> {
    const key = cacheKey(title, artist);
    const lrcPath = join(CACHE_DIR, `${key}.lrc`);
    try {
        const s = await stat(lrcPath);
        if (Date.now() - s.mtimeMs > TTL_MS) return null;
        const lrc = await readFile(lrcPath, 'utf-8');
        let tlrc: string | undefined;
        try {
            tlrc = await readFile(join(CACHE_DIR, `${key}.tlrc`), 'utf-8');
        } catch { /* no translation */ }
        return { lrc, tlrc };
    } catch {
        return null;
    }
}

export async function setCache(title: string, artist: string, lrc: string, tlrc?: string): Promise<void> {
    await mkdir(CACHE_DIR, { recursive: true });
    const key = cacheKey(title, artist);
    await writeFile(join(CACHE_DIR, `${key}.lrc`), lrc, 'utf-8');
    if (tlrc) {
        await writeFile(join(CACHE_DIR, `${key}.tlrc`), tlrc, 'utf-8');
    }
    await evictOldEntries();
}

async function evictOldEntries(): Promise<void> {
    try {
        const files = await readdir(CACHE_DIR);
        const lrcFiles = files.filter(f => f.endsWith('.lrc'));
        if (lrcFiles.length <= MAX_ENTRIES) return;

        const entries = await Promise.all(
            lrcFiles.map(async f => {
                const s = await stat(join(CACHE_DIR, f));
                return { file: f, mtime: s.mtimeMs };
            }),
        );
        entries.sort((a, b) => a.mtime - b.mtime);

        const toRemove = entries.slice(0, entries.length - MAX_ENTRIES);
        for (const entry of toRemove) {
            const base = entry.file.replace('.lrc', '');
            await unlink(join(CACHE_DIR, entry.file)).catch(() => {});
            await unlink(join(CACHE_DIR, `${base}.tlrc`)).catch(() => {});
        }
    } catch { /* ignore eviction errors */ }
}

export async function clearCache(): Promise<void> {
    try {
        const files = await readdir(CACHE_DIR);
        for (const f of files) {
            await unlink(join(CACHE_DIR, f)).catch(() => {});
        }
    } catch { /* ignore */ }
}
