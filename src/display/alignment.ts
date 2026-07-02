export interface AlignedDecorationContent {
    primaryContent: string;
    secondaryContent: string;
}

export function alignDecorationContent(
    primaryLineText: string,
    secondaryLineText: string,
    primaryContent: string,
    secondaryContent: string,
    tabSize: number,
): AlignedDecorationContent {
    const safeTabSize = tabSize > 0 ? tabSize : 4;
    const primaryColumn = visualColumn(primaryLineText, safeTabSize);
    const secondaryColumn = visualColumn(secondaryLineText, safeTabSize);
    const targetColumn = Math.max(primaryColumn, secondaryColumn);

    return {
        primaryContent: `${' '.repeat(targetColumn - primaryColumn)}${primaryContent}`,
        secondaryContent: `${' '.repeat(targetColumn - secondaryColumn)}${secondaryContent}`,
    };
}

export function visualColumn(text: string, tabSize: number): number {
    const safeTabSize = tabSize > 0 ? tabSize : 4;
    let column = 0;

    for (const char of text) {
        if (char === '\t') {
            column += safeTabSize - (column % safeTabSize);
        } else {
            column += isWideCodePoint(char.codePointAt(0) ?? 0) ? 2 : 1;
        }
    }

    return column;
}

function isWideCodePoint(codePoint: number): boolean {
    return (
        (codePoint >= 0x1100 && codePoint <= 0x115f) ||
        (codePoint >= 0x2329 && codePoint <= 0x232a) ||
        (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
        (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
        (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
        (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
        (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
        (codePoint >= 0xff00 && codePoint <= 0xff60) ||
        (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    );
}
