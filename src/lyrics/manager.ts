import type { NowPlaying } from '../player/index';
import type { LyricsProvider, LyricsSearchResult } from './providers/index';
import type { Lyrics } from './parser';
import { parseLRC } from './parser';
import { similarity } from '../utils/similarity';
import { getCached, setCache } from '../utils/cache';
import { NeteaseProvider } from './providers/netease';
import { QQMusicProvider } from './providers/qq';

export class LyricsManager {
    private providers: LyricsProvider[];
    private currentLyrics: Lyrics | null = null;
    private currentTrackKey = '';
    private logger: { info: (...args: any[]) => void; debug: (...args: any[]) => void; warn: (...args: any[]) => void; error: (...args: any[]) => void };

    constructor(
        providerOrder: string[],
        logger: { info: (...args: any[]) => void; debug: (...args: any[]) => void; warn: (...args: any[]) => void; error: (...args: any[]) => void },
    ) {
        const allProviders: Record<string, LyricsProvider> = {
            netease: new NeteaseProvider(),
            qq: new QQMusicProvider(),
        };
        this.providers = providerOrder
            .filter(name => name in allProviders)
            .map(name => allProviders[name]);
        this.logger = logger;
    }

    async getLyrics(track: NowPlaying): Promise<Lyrics | null> {
        const trackKey = `${track.title}\n${track.artist}`;
        if (trackKey === this.currentTrackKey && this.currentLyrics) {
            return this.currentLyrics;
        }

        this.currentTrackKey = trackKey;
        this.currentLyrics = null;

        const cached = await getCached(track.title, track.artist);
        if (cached) {
            this.logger.info(`[Lyrics] Cache hit for "${track.title}" - ${track.artist}`);
            this.currentLyrics = parseLRC(cached.lrc, cached.tlrc);
            return this.currentLyrics;
        }

        const allResults = await this.searchAll(track);
        const best = this.pickBest(track, allResults);

        if (best) {
            this.logger.info(`[Lyrics] Loaded lyrics for "${track.title}" from ${best.source} (${parseLRC(best.lrc).lines.length} lines)`);
            await setCache(track.title, track.artist, best.lrc, best.tlrc);
            this.currentLyrics = parseLRC(best.lrc, best.tlrc);
        } else {
            this.logger.warn(`[Lyrics] No lyrics found for "${track.title}" - ${track.artist}`);
        }

        return this.currentLyrics;
    }

    resetTrack(): void {
        this.currentTrackKey = '';
        this.currentLyrics = null;
    }

    private async searchAll(track: NowPlaying): Promise<LyricsSearchResult[]> {
        const results: LyricsSearchResult[] = [];
        for (const provider of this.providers) {
            try {
                this.logger.debug(`[Lyrics] Searching: ${provider.name} query="${track.title} ${track.artist}"`);
                const start = performance.now();
                const found = await provider.search(track.title, track.artist, track.duration);
                this.logger.debug(`[Perf] ${provider.name} search: ${(performance.now() - start).toFixed(1)}ms`);
                results.push(...found);
            } catch (e) {
                this.logger.warn(`[Lyrics] ${provider.name} failed: ${e}`);
            }
        }
        return results;
    }

    private pickBest(track: NowPlaying, candidates: LyricsSearchResult[]): LyricsSearchResult | null {
        const scored = candidates
            .map(c => {
                const titleSim = similarity(c.title, track.title);
                const durationDiff = track.duration > 0 ? Math.abs(c.duration - track.duration) : 0;
                return { result: c, titleSim, durationDiff };
            })
            .filter(c => c.titleSim > 0.5 && (track.duration === 0 || c.durationDiff < 5000));

        scored.sort((a, b) => {
            const qualDiff = b.result.quality - a.result.quality;
            if (Math.abs(qualDiff) > 0.01) return qualDiff;
            return b.titleSim - a.titleSim;
        });

        if (scored.length > 0) {
            const best = scored[0];
            this.logger.debug(`[Lyrics] Match score: title=${best.titleSim.toFixed(2)}, duration_diff=${best.durationDiff}ms`);
            return best.result;
        }
        return null;
    }
}
