import type { NowPlaying, PlayerBackend } from './index';

type PerfLogger = (backendName: string, elapsedMs: number) => void;

export async function getNowPlayingFromBackends(
    backends: PlayerBackend[],
    logPerf?: PerfLogger,
): Promise<NowPlaying | null> {
    let pausedFallback: NowPlaying | null = null;

    for (const backend of backends) {
        const start = performance.now();
        const result = await backend.getNowPlaying();
        logPerf?.(backend.name, performance.now() - start);
        if (!result) {
            continue;
        }
        if (result.isPlaying) {
            return result;
        }
        pausedFallback = result;
    }

    return pausedFallback;
}
