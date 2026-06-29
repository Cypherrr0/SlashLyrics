import * as vscode from 'vscode';
import type { Lyrics } from '../lyrics/parser';
import { getCurrentLineIndex } from '../lyrics/parser';

export class DecorationDisplay implements vscode.Disposable {
    private decorationType: vscode.TextEditorDecorationType;
    private currentLine = -1;

    constructor() {
        this.decorationType = vscode.window.createTextEditorDecorationType({
            after: {
                margin: '0 0 0 2em',
                fontStyle: 'italic',
            },
            isWholeLine: true,
        });
    }

    update(lyrics: Lyrics, position: number, editor: vscode.TextEditor): void {
        const index = getCurrentLineIndex(lyrics, position);
        if (index < 0 || index === this.currentLine) {
            if (index < 0) this.clear(editor);
            return;
        }

        this.currentLine = index;
        const line = lyrics.lines[index];
        const config = vscode.workspace.getConfiguration('slashlyrics');
        const prefix = config.get<string>('prefix', '♪ ');
        const color = config.get<string>('color', '#6b7280');
        const showTranslation = config.get<boolean>('showTranslation', false);
        const separator = config.get<string>('translationSeparator', ' | ');

        let text = `${prefix}${line.text}`;
        if (showTranslation && line.translation) {
            text += `${separator}${line.translation}`;
        }

        const displayMode = config.get<string>('displayMode', 'cursor-line');
        let targetLine: number;

        switch (displayMode) {
            case 'top-line':
                targetLine = editor.visibleRanges[0]?.start.line ?? 0;
                break;
            case 'cursor-line':
            default:
                targetLine = editor.selection.active.line;
                break;
        }

        const range = new vscode.Range(targetLine, 0, targetLine, 0);
        editor.setDecorations(this.decorationType, [
            {
                range,
                renderOptions: {
                    after: {
                        contentText: text,
                        color,
                    },
                },
            },
        ]);
    }

    clear(editor: vscode.TextEditor): void {
        this.currentLine = -1;
        editor.setDecorations(this.decorationType, []);
    }

    reset(editor?: vscode.TextEditor): void {
        this.currentLine = -1;
        if (editor) {
            editor.setDecorations(this.decorationType, []);
        }
    }

    dispose(): void {
        this.decorationType.dispose();
    }
}
