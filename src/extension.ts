import * as vscode from 'vscode';
import type { PlayerBackend, NowPlaying } from './player/index';
import { MediaRemoteBackend } from './player/mediaremote';
import { NeteaseBackend } from './player/netease';
import { AppleScriptBackend } from './player/applescript';
import { getNowPlayingFromBackends } from './player/selection';
import { LyricsManager } from './lyrics/manager';
import { DecorationDisplay } from './display/decoration';
import { StatusBarDisplay } from './display/statusbar';
import { clearCache } from './utils/cache';

let logger: vscode.LogOutputChannel;

export function activate(context: vscode.ExtensionContext): void {
    logger = vscode.window.createOutputChannel('SlashLyrics', { log: true });
    logger.info('[SlashLyrics] Extension activated');

    const mediaRemoteBackend = new MediaRemoteBackend(context.extensionPath, logger);
    const neteaseBackend = new NeteaseBackend(logger);
    const appleScriptBackend = new AppleScriptBackend();

    const config = vscode.workspace.getConfiguration('slashlyrics');
    const providerOrder = config.get<string[]>('providers', ['netease', 'qq']);
    const lyricsManager = new LyricsManager(providerOrder, logger);
    const decoration = new DecorationDisplay();
    const statusBar = new StatusBarDisplay();

    let enabled = config.get<boolean>('enabled', true);
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let pollInFlight = false;
    let pollEpoch = 0;
    let lastTrackKey = '';
    let lastSource: NowPlaying['source'] | undefined;

    context.subscriptions.push(decoration, statusBar, logger);

    context.subscriptions.push(
        vscode.commands.registerCommand('slashlyrics.toggle', () => {
            enabled = !enabled;
            logger.info(`[SlashLyrics] ${enabled ? 'Enabled' : 'Disabled'}`);
            if (!enabled) {
                stopPolling();
                statusBar.setIdle();
                const editor = vscode.window.activeTextEditor;
                if (editor) decoration.clear(editor);
            } else {
                startPolling();
            }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('slashlyrics.clearCache', async () => {
            await clearCache();
            lyricsManager.resetTrack();
            vscode.window.showInformationMessage('SlashLyrics: Cache cleared');
            logger.info('[Lyrics] Cache cleared');
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('slashlyrics.diagnoseNowPlaying', async () => {
            const report = [
                await mediaRemoteBackend.diagnose(),
                '',
                await neteaseBackend.diagnose(),
            ].join('\n');
            logger.info(report);
            logger.show(true);
            await vscode.env.clipboard.writeText(report);
            vscode.window.showInformationMessage('SlashLyrics: Now Playing diagnostics copied to clipboard');
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('slashlyrics.searchLyrics', () => {
            vscode.window.showInformationMessage('SlashLyrics: Manual search coming in v0.2');
        }),
    );

    async function poll(epoch: number): Promise<void> {
        // setInterval does not await async callbacks. SQLite can wait on a
        // NetEase write lock, so guard against overlapping child processes and
        // discard results from polling sessions that were stopped/restarted.
        if (!enabled || epoch !== pollEpoch || pollInFlight) return;
        pollInFlight = true;

        try {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            // MediaRemote waits up to 1.5 seconds when NetEase publishes no
            // system Now Playing data. Reuse the last successful source first
            // so later NetEase polls go directly to the local backend.
            const backends: PlayerBackend[] = lastSource === 'netease'
                ? [neteaseBackend, mediaRemoteBackend, appleScriptBackend]
                : lastSource === 'applescript'
                    ? [appleScriptBackend, mediaRemoteBackend, neteaseBackend]
                    : [mediaRemoteBackend, neteaseBackend, appleScriptBackend];

            const nowPlaying = await getNowPlayingFromBackends(backends, (backendName, elapsedMs) => {
                logger.debug(`[Perf] ${backendName}: ${elapsedMs.toFixed(1)}ms`);
            });
            if (!enabled || epoch !== pollEpoch) return;

            if (!nowPlaying) {
                statusBar.setIdle();
                decoration.clear(editor);
                return;
            }

            lastSource = nowPlaying.source;

            const trackKey = `${nowPlaying.title}\n${nowPlaying.artist}`;
            if (trackKey !== lastTrackKey) {
                lastTrackKey = trackKey;
                logger.info(`[Player] Now playing: ${nowPlaying.title} - ${nowPlaying.artist}`);
                lyricsManager.resetTrack();
                decoration.reset(editor);
            }

            statusBar.updateTrack(nowPlaying);

            const lyrics = await lyricsManager.getLyrics(nowPlaying);
            if (!enabled || epoch !== pollEpoch) return;

            if (lyrics) {
                decoration.update(lyrics, nowPlaying.position, editor);
            } else {
                decoration.clear(editor);
            }
        } catch (error) {
            logger.error(`[SlashLyrics] Poll failed: ${String(error)}`);
        } finally {
            pollInFlight = false;
        }
    }

    function startPolling(): void {
        if (pollTimer) return;
        const interval = Math.max(100, config.get<number>('pollInterval', 250));
        const epoch = ++pollEpoch;
        void poll(epoch);
        pollTimer = setInterval(() => void poll(epoch), interval);
    }

    function stopPolling(): void {
        pollEpoch += 1;
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = undefined;
        }
    }

    if (enabled) {
        startPolling();
    }

    const pauseOnBlur = config.get<boolean>('pauseOnBlur', false);
    if (pauseOnBlur) {
        context.subscriptions.push(
            vscode.window.onDidChangeWindowState((state) => {
                if (state.focused && enabled) startPolling();
                else stopPolling();
            }),
        );
    }

    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection((event) => {
            if (!enabled || event.textEditor !== vscode.window.activeTextEditor) return;
            decoration.refresh(event.textEditor);
        }),
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('slashlyrics')) {
                logger.info('[SlashLyrics] Configuration changed, reloading');
                if (e.affectsConfiguration('slashlyrics.pollInterval') && enabled) {
                    stopPolling();
                    startPolling();
                }
            }
        }),
    );

    context.subscriptions.push({ dispose: stopPolling });
}

export function deactivate(): void {
    logger?.info('[SlashLyrics] Extension deactivated');
}
