export interface LyricsLine {
    time: number;
    text: string;
    translation?: string;
}

export interface Lyrics {
    title?: string;
    artist?: string;
    offset: number;
    lines: LyricsLine[];
}

const TAG_RE = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g;
const META_RE = /\[(\w+):(.*)\]/;

export function parseLRC(raw: string, translationRaw?: string): Lyrics {
    const lyrics: Lyrics = { offset: 0, lines: [] };
    const translationMap = translationRaw ? buildTranslationMap(translationRaw) : undefined;

    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const times: number[] = [];
        let text = trimmed;

        let match: RegExpExecArray | null;
        TAG_RE.lastIndex = 0;
        while ((match = TAG_RE.exec(trimmed)) !== null) {
            const minutes = parseInt(match[1], 10);
            const seconds = parseInt(match[2], 10);
            const centis = match[3].length === 3
                ? parseInt(match[3], 10)
                : parseInt(match[3], 10) * 10;
            times.push(minutes * 60000 + seconds * 1000 + centis);
        }

        if (times.length > 0) {
            text = trimmed.replace(TAG_RE, '').trim();
            if (!text) continue;
            for (const time of times) {
                lyrics.lines.push({
                    time,
                    text,
                    translation: translationMap?.get(time),
                });
            }
        } else {
            const metaMatch = trimmed.match(META_RE);
            if (metaMatch) {
                const [, key, value] = metaMatch;
                switch (key.toLowerCase()) {
                    case 'ti': lyrics.title = value.trim(); break;
                    case 'ar': lyrics.artist = value.trim(); break;
                    case 'offset': lyrics.offset = parseInt(value.trim(), 10) || 0; break;
                }
            }
        }
    }

    lyrics.lines.sort((a, b) => a.time - b.time);
    return lyrics;
}

function buildTranslationMap(raw: string): Map<number, string> {
    const map = new Map<number, string>();
    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const times: number[] = [];
        TAG_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = TAG_RE.exec(trimmed)) !== null) {
            const minutes = parseInt(match[1], 10);
            const seconds = parseInt(match[2], 10);
            const centis = match[3].length === 3
                ? parseInt(match[3], 10)
                : parseInt(match[3], 10) * 10;
            times.push(minutes * 60000 + seconds * 1000 + centis);
        }

        const text = trimmed.replace(TAG_RE, '').trim();
        if (text && times.length > 0) {
            for (const time of times) {
                map.set(time, text);
            }
        }
    }
    return map;
}

export function getCurrentLineIndex(lyrics: Lyrics, position: number): number {
    const adjusted = position + lyrics.offset;
    const { lines } = lyrics;
    let lo = 0;
    let hi = lines.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (lines[mid].time <= adjusted) lo = mid + 1;
        else hi = mid - 1;
    }
    return hi;
}

export function getNextLineTime(lyrics: Lyrics, currentIndex: number): number | null {
    const nextIndex = currentIndex + 1;
    if (nextIndex >= lyrics.lines.length) return null;
    return lyrics.lines[nextIndex].time - lyrics.offset;
}
