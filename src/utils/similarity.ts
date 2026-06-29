export function similarity(a: string, b: string): number {
    const sa = normalize(a);
    const sb = normalize(b);
    if (sa === sb) return 1;
    if (sa.length === 0 || sb.length === 0) return 0;

    const maxLen = Math.max(sa.length, sb.length);
    const dist = levenshtein(sa, sb);
    return 1 - dist / maxLen;
}

function normalize(s: string): string {
    return s.toLowerCase().replace(/[\s\-_()（）【】\[\]]/g, '');
}

function levenshtein(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);

    for (let i = 1; i <= m; i++) {
        let prev = dp[0];
        dp[0] = i;
        for (let j = 1; j <= n; j++) {
            const temp = dp[j];
            if (a[i - 1] === b[j - 1]) {
                dp[j] = prev;
            } else {
                dp[j] = 1 + Math.min(prev, dp[j], dp[j - 1]);
            }
            prev = temp;
        }
    }

    return dp[n];
}
