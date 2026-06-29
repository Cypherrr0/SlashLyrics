import type { LyricsProvider, LyricsSearchResult } from './index';
import { request } from 'node:https';

interface NeteaseSearchItem {
    id: number;
    name: string;
    artists: { name: string }[];
    duration: number;
}

export class NeteaseProvider implements LyricsProvider {
    readonly name = 'netease';

    async search(title: string, artist: string, duration: number): Promise<LyricsSearchResult[]> {
        const query = `${title} ${artist}`;
        const searchUrl = `https://music.163.com/api/search/get?s=${encodeURIComponent(query)}&type=1&limit=5`;

        const searchData = await httpGet(searchUrl, {
            Referer: 'https://music.163.com',
            'User-Agent': 'Mozilla/5.0',
        });

        const songs: NeteaseSearchItem[] = searchData?.result?.songs ?? [];
        const results: LyricsSearchResult[] = [];

        for (const song of songs.slice(0, 3)) {
            try {
                const lyricData = await httpGet(
                    `https://music.163.com/api/song/lyric?id=${song.id}&lv=1&tv=1`,
                    { Referer: 'https://music.163.com', 'User-Agent': 'Mozilla/5.0' },
                );

                const lrc = lyricData?.lrc?.lyric;
                if (!lrc) continue;

                const songArtist = song.artists?.map(a => a.name).join(', ') ?? '';
                results.push({
                    title: song.name,
                    artist: songArtist,
                    duration: song.duration,
                    lrc,
                    tlrc: lyricData?.tlyric?.lyric || undefined,
                    quality: 1,
                    source: 'netease',
                });
            } catch { /* skip failed lyrics fetch */ }
        }

        return results;
    }
}

function httpGet(url: string, headers: Record<string, string> = {}): Promise<any> {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const req = request(
            {
                hostname: urlObj.hostname,
                path: urlObj.pathname + urlObj.search,
                method: 'GET',
                headers,
            },
            (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch {
                        reject(new Error('Invalid JSON'));
                    }
                });
            },
        );
        req.on('error', reject);
        req.setTimeout(5000, () => {
            req.destroy();
            reject(new Error('Timeout'));
        });
        req.end();
    });
}
