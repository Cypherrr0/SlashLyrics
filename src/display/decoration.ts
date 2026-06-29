import * as vscode from 'vscode';
import type { Lyrics } from '../lyrics/parser';
import { getCurrentLineIndex } from '../lyrics/parser';

export class DecorationDisplay implements vscode.Disposable {
    private decorationType: vscode.TextEditorDecorationType;
    private translationDecorationType: vscode.TextEditorDecorationType;
    private lastLyrics: Lyrics | null = null;
    private lastPosition = 0;

    constructor() {
        this.decorationType = vscode.window.createTextEditorDecorationType({
            after: {
                margin: '0 0 0 2em',
                fontStyle: 'italic',
            },
            isWholeLine: true,
        });
        this.translationDecorationType = vscode.window.createTextEditorDecorationType({
            after: {
                margin: '0 0 0 2em',
                fontStyle: 'italic',
            },
            isWholeLine: true,
        });
    }

    update(lyrics: Lyrics, position: number, editor: vscode.TextEditor): void {
        this.lastLyrics = lyrics;
        this.lastPosition = position;
        this.render(editor);
    }

    refresh(editor: vscode.TextEditor): void {
        if (!this.lastLyrics) return;
        this.render(editor);
    }

    private render(editor: vscode.TextEditor): void {
        const lyrics = this.lastLyrics;
        if (!lyrics) return;

        const position = this.lastPosition;
        const index = getCurrentLineIndex(lyrics, position);
        if (index < 0) {
            this.clear(editor);
            return;
        }

        const line = lyrics.lines[index];
        const config = vscode.workspace.getConfiguration('slashlyrics');
        const prefix = config.get<string>('prefix', '♪ ');
        const showColor = config.get<boolean>('showColor', true);
        const color = showColor ? config.get<string>('color', '#6b7280') : undefined;
        const showTranslation = config.get<boolean>('showTranslation', false);

        const text = `${prefix}${line.text}`;
        const translationText = showTranslation && line.translation
            ? `${prefix}${line.translation}`
            : undefined;

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
        const translationTargetLine = targetLine > 0 ? targetLine - 1 : undefined;
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
        editor.setDecorations(this.translationDecorationType, translationText && translationTargetLine !== undefined ? [
            {
                range: new vscode.Range(translationTargetLine, 0, translationTargetLine, 0),
                renderOptions: {
                    after: {
                        contentText: translationText,
                        color,
                    },
                },
            },
        ] : []);
    }

    clear(editor: vscode.TextEditor): void {
        this.lastLyrics = null;
        this.lastPosition = 0;
        editor.setDecorations(this.decorationType, []);
        editor.setDecorations(this.translationDecorationType, []);
    }

    reset(editor?: vscode.TextEditor): void {
        this.lastLyrics = null;
        this.lastPosition = 0;
        if (editor) {
            editor.setDecorations(this.decorationType, []);
            editor.setDecorations(this.translationDecorationType, []);
        }
    }

    dispose(): void {
        this.decorationType.dispose();
        this.translationDecorationType.dispose();
    }
}
