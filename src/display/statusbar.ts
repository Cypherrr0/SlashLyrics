import * as vscode from 'vscode';
import type { NowPlaying } from '../player/index';

export class StatusBarDisplay implements vscode.Disposable {
    private item: vscode.StatusBarItem;

    constructor() {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.item.command = 'slashlyrics.toggle';
        this.item.tooltip = 'SlashLyrics - Click to toggle';
        this.setIdle();
        this.item.show();
    }

    updateTrack(track: NowPlaying): void {
        const display = track.artist ? `${track.artist} - ${track.title}` : track.title;
        this.item.text = `$(music) ${display}`;
    }

    setIdle(): void {
        this.item.text = '$(music) SlashLyrics';
    }

    dispose(): void {
        this.item.dispose();
    }
}
