import type { PlayerBackend, NowPlaying } from './index';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { existsSync, statSync } from 'node:fs';

interface HelperRunResult {
    ok: boolean;
    helperPath: string;
    exists: boolean;
    mode?: string;
    stdout: string;
    stderr: string;
    error?: string;
}

type Logger = {
    debug: (...args: any[]) => void;
    warn: (...args: any[]) => void;
};

export class MediaRemoteBackend implements PlayerBackend {
    readonly name = 'mediaremote';
    private helperPath: string;

    constructor(extensionPath: string, private logger?: Logger) {
        this.helperPath = join(extensionPath, 'bin', 'nowplaying-helper');
    }

    async getNowPlaying(): Promise<NowPlaying | null> {
        const result = await this.runHelper();
        if (!result.ok || !result.stdout.trim()) {
            this.logFailure(result);
            return null;
        }

        try {
            const data = JSON.parse(result.stdout);
            if (!data.title) {
                this.logger?.debug(`[Player] MediaRemote returned no title: ${result.stdout.trim()}`);
                return null;
            }
            return {
                title: data.title || '',
                artist: data.artist || '',
                album: data.album || '',
                duration: data.duration || 0,
                position: data.position || 0,
                isPlaying: data.isPlaying ?? true,
                source: 'mediaremote',
            };
        } catch (e) {
            this.logger?.warn(`[Player] MediaRemote returned invalid JSON: ${e}; stdout=${result.stdout.trim()}`);
            return null;
        }
    }

    async diagnose(): Promise<string> {
        const result = await this.runHelper(['--debug'], 5000);
        const lines = [
            'SlashLyrics MediaRemote Diagnostics',
            `helperPath=${result.helperPath}`,
            `exists=${result.exists}`,
            `mode=${result.mode ?? 'unknown'}`,
            `ok=${result.ok}`,
            `error=${result.error ?? ''}`,
            'stdout:',
            result.stdout.trim() || '<empty>',
            'stderr:',
            result.stderr.trim() || '<empty>',
        ];
        return lines.join('\n');
    }

    private runHelper(args: string[] = [], timeout = 3000): Promise<HelperRunResult> {
        const exists = existsSync(this.helperPath);
        if (!exists) {
            return Promise.resolve({
                ok: false,
                helperPath: this.helperPath,
                exists,
                stdout: '',
                stderr: '',
                error: 'helper missing',
            });
        }

        const mode = this.helperMode();
        return new Promise((resolve) => {
            execFile(this.helperPath, args, { timeout }, (err, stdout, stderr) => {
                resolve({
                    ok: !err,
                    helperPath: this.helperPath,
                    exists,
                    mode,
                    stdout,
                    stderr,
                    error: err ? `${err.name}: ${err.message}` : undefined,
                });
            });
        });
    }

    private helperMode(): string | undefined {
        try {
            return (statSync(this.helperPath).mode & 0o777).toString(8);
        } catch {
            return undefined;
        }
    }

    private logFailure(result: HelperRunResult): void {
        if (!result.exists) {
            this.logger?.warn(`[Player] MediaRemote helper missing: ${result.helperPath}`);
            return;
        }
        if (result.error) {
            this.logger?.warn(`[Player] MediaRemote helper failed: ${result.error}; mode=${result.mode}; stderr=${result.stderr.trim()}`);
            return;
        }
        this.logger?.debug('[Player] MediaRemote helper returned empty stdout');
    }
}
