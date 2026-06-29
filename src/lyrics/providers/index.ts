export interface LyricsSearchResult {
    title: string;
    artist: string;
    duration: number;
    lrc: string;
    tlrc?: string;
    quality: number;
    source: string;
}

export interface LyricsProvider {
    readonly name: string;
    search(title: string, artist: string, duration: number): Promise<LyricsSearchResult[]>;
}
