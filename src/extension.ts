import * as vscode from 'vscode';
import type { PlayerBackend, NowPlaying } from './player/index';
import { MediaRemoteBackend } from './player/mediaremote';
import { AppleScriptBackend } from './player/applescript';
import { LyricsManager } from './lyrics/manager';
import { DecorationDisplay } from './display/decoration';
import { StatusBarDisplay } from './display/statusbar';
import { clearCache } from './utils/cache';

let logger: vscode.LogOutputChannel;

export function activate(context: vscode.ExtensionContext): void {
    logger = vscode.window.createOutputChannel('SlashLyrics', { log: true });
    logger.info('[SlashLyrics] Extension activated');

    const mediaRemoteBackend = new MediaRemoteBackend(context.extensionPath, logger);
    const backends: PlayerBackend[] = [
        mediaRemoteBackend,
        new AppleScriptBackend(),
    ];

    const config = vscode.workspace.getConfiguration('slashlyrics');
    const providerOrder = config.get<string[]>('providers', ['netease', 'qq']);
    const lyricsManager = new LyricsManager(providerOrder, logger);
    const decoration = new DecorationDisplay();
    const statusBar = new StatusBarDisplay();

    let enabled = config.get<boolean>('enabled', true);
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let lastTrackKey = '';

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
            const report = await mediaRemoteBackend.diagnose();
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

    async function poll(): Promise<void> {
        if (!enabled) return;

        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        let nowPlaying: NowPlaying | null = null;
        for (const backend of backends) {
            const start = performance.now();
            nowPlaying = await backend.getNowPlaying();
            logger.debug(`[Perf] ${backend.name}: ${(performance.now() - start).toFixed(1)}ms`);
            if (nowPlaying) break;
        }

        if (!nowPlaying || !nowPlaying.isPlaying) {
            statusBar.setIdle();
            decoration.clear(editor);
            return;
        }

        const trackKey = `${nowPlaying.title}\n${nowPlaying.artist}`;
        if (trackKey !== lastTrackKey) {
            lastTrackKey = trackKey;
            logger.info(`[Player] Now playing: ${nowPlaying.title} - ${nowPlaying.artist}`);
            lyricsManager.resetTrack();
            decoration.reset(editor);
        }

        statusBar.updateTrack(nowPlaying);

        const lyrics = await lyricsManager.getLyrics(nowPlaying);
        if (lyrics) {
            decoration.update(lyrics, nowPlaying.position, editor);
        } else {
            decoration.clear(editor);
        }
    }

    function startPolling(): void {
        if (pollTimer) return;
        const interval = config.get<number>('pollInterval', 1000);
        poll();
        pollTimer = setInterval(poll, interval);
    }

    function stopPolling(): void {
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
            }
        }),
    );
}

export function deactivate(): void {
    logger?.info('[SlashLyrics] Extension deactivated');
}
