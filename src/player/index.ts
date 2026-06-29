export interface NowPlaying {
    title: string;
    artist: string;
    album: string;
    duration: number;
    position: number;
    isPlaying: boolean;
    source: 'mediaremote' | 'applescript';
}

export interface PlayerBackend {
    getNowPlaying(): Promise<NowPlaying | null>;
    readonly name: string;
}
