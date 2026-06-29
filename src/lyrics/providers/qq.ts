import type { LyricsProvider, LyricsSearchResult } from './index';
import { request } from 'node:https';

export class QQMusicProvider implements LyricsProvider {
    readonly name = 'qq';

    async search(title: string, artist: string, _duration: number): Promise<LyricsSearchResult[]> {
        const query = `${title} ${artist}`;
        const searchUrl = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${encodeURIComponent(query)}&format=json&p=1&n=5`;

        const searchData = await httpGet(searchUrl, {
            Referer: 'https://y.qq.com',
            'User-Agent': 'Mozilla/5.0',
        });

        const songs = searchData?.data?.song?.list ?? [];
        const results: LyricsSearchResult[] = [];

        for (const song of songs.slice(0, 3)) {
            try {
                const mid = song.songmid;
                if (!mid) continue;

                const lyricData = await httpGet(
                    `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${mid}&format=json&nobase64=1`,
                    { Referer: 'https://y.qq.com', 'User-Agent': 'Mozilla/5.0' },
                );

                const lrc = lyricData?.lyric;
                if (!lrc) continue;

                const songArtist = song.singer?.map((s: any) => s.name).join(', ') ?? '';
                results.push({
                    title: song.songname,
                    artist: songArtist,
                    duration: (song.interval ?? 0) * 1000,
                    lrc,
                    tlrc: lyricData?.trans || undefined,
                    quality: 0.9,
                    source: 'qq',
                });
            } catch { /* skip */ }
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
