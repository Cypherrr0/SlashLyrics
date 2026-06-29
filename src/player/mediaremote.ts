import type { PlayerBackend, NowPlaying } from './index';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

export class MediaRemoteBackend implements PlayerBackend {
    readonly name = 'mediaremote';
    private helperPath: string;

    constructor(extensionPath: string) {
        this.helperPath = join(extensionPath, 'bin', 'nowplaying-helper');
    }

    async getNowPlaying(): Promise<NowPlaying | null> {
        if (!existsSync(this.helperPath)) return null;

        return new Promise((resolve) => {
            execFile(this.helperPath, { timeout: 3000 }, (err, stdout) => {
                if (err || !stdout.trim()) return resolve(null);
                try {
                    const data = JSON.parse(stdout);
                    if (!data.title) return resolve(null);
                    resolve({
                        title: data.title || '',
                        artist: data.artist || '',
                        album: data.album || '',
                        duration: data.duration || 0,
                        position: data.position || 0,
                        isPlaying: data.isPlaying ?? true,
                        source: 'mediaremote',
                    });
                } catch {
                    resolve(null);
                }
            });
        });
    }
}
