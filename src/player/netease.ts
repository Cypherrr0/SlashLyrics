import type { PlayerBackend, NowPlaying } from './index';
import { execFile } from 'node:child_process';
import { createDecipheriv } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { request } from 'node:https';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HISTORY_QUERY = 'select playtime,id,jsonStr from historyTracks order by playtime desc limit 1;';
const STALE_GRACE_MS = 120_000;
const SQLITE_PATH = '/usr/bin/sqlite3';
const NETEASE_STORAGE_KEY = Buffer.from(')(13daqP@ssw0rd~');
const PLAYING_INFO_KEY = 'playingInfo';
const LAST_PLAYING_KEY = 'lastPlaying';
const NETEASE_PLAYING_STATE = 2;
const BASE64_CANDIDATE_RE = /[A-Za-z0-9+/]{80,}={0,2}/g;
const REQUEST_CACHE_MAX_BUFFER = 16 * 1024 * 1024;
const PAUSED_PROGRESS_STABLE_MS = 3000;

type Logger = {
    debug: (...args: any[]) => void;
    warn: (...args: any[]) => void;
};

interface SqliteHistoryRow {
    playtime?: number | string;
    id?: string;
    jsonStr?: string;
}

interface SqliteJsonRow {
    jsonStr?: string;
}

interface NeteaseTrackJson {
    id?: string | number;
    name?: string;
    artist?: string;
    duration?: number;
    dt?: number;
    artists?: Array<{ name?: string }>;
    ar?: Array<{ name?: string }>;
    album?: {
        name?: string;
        albumName?: string;
    };
    al?: {
        name?: string;
    };
}

interface NeteaseLastPlayingJson {
    trackId?: string | number;
    resourceId?: string | number;
    current?: number | string;
    resourceDuration?: number | string;
    updatedAt?: number;
}

interface NeteasePlayingInfoJson {
    playingState?: number | string;
    playId?: string | number;
    resourceTrackId?: string | number;
    onlineResourceId?: string | number;
    resourceDuration?: number | string;
    current?: number | string;
    curPlaying?: {
        resourceId?: string | number;
        trackId?: string | number;
        track?: NeteaseTrackJson;
        localTrack?: NeteaseTrackJson;
    };
}

interface NeteaseSongDetailResponse {
    songs?: NeteaseTrackJson[];
}

interface NeteaseTrackMetadata {
    id?: string;
    title: string;
    artist: string;
    album: string;
    duration: number;
}

export interface NeteaseHistoryResult {
    track: NowPlaying | null;
    reason?: string;
}

export class NeteaseBackend implements PlayerBackend {
    readonly name = 'netease';
    private readonly dbPath: string;
    private readonly levelDbPath: string;
    private lastLiveState?: {
        trackId: string;
        current: number;
        sampledAt: number;
    };

    constructor(private logger?: Logger, dbPath = defaultNeteaseDbPath(), levelDbPath = defaultNeteaseLevelDbPath()) {
        this.dbPath = dbPath;
        this.levelDbPath = levelDbPath;
    }

    async getNowPlaying(): Promise<NowPlaying | null> {
        const result = await this.readNowPlaying(Date.now());
        if (!result.track) {
            this.logger?.debug(`[Player] NetEase fallback unavailable: ${result.reason ?? 'unknown'}`);
        }
        return result.track;
    }

    async diagnose(): Promise<string> {
        const dbExists = existsSync(this.dbPath);
        const levelDbExists = existsSync(this.levelDbPath);
        const result = await this.readNowPlaying(Date.now());
        const lines = [
            'SlashLyrics NetEase Diagnostics',
            `dbPath=${this.dbPath}`,
            `dbExists=${dbExists}`,
            `levelDbPath=${this.levelDbPath}`,
            `levelDbExists=${levelDbExists}`,
            `ok=${Boolean(result.track)}`,
            `reason=${result.reason ?? ''}`,
            'track:',
            result.track ? JSON.stringify(result.track) : '<empty>',
        ];
        return lines.join('\n');
    }

    private async readNowPlaying(nowMs: number): Promise<NeteaseHistoryResult> {
        const liveResult = await this.readLiveTrack();
        if (liveResult.track || liveResult.reason === 'not playing') {
            return liveResult;
        }

        if (liveResult.reason !== 'leveldb missing' && liveResult.reason !== 'live state missing') {
            return liveResult;
        }

        const historyResult = await this.readLatestHistoryTrack(nowMs);
        return historyResult.track ? historyResult : liveResult;
    }

    private async readLiveTrack(): Promise<NeteaseHistoryResult> {
        if (!existsSync(this.levelDbPath)) {
            return { track: null, reason: 'leveldb missing' };
        }

        let values: Record<string, string | undefined>;
        try {
            values = await readNeteaseStorageValues(this.levelDbPath, [PLAYING_INFO_KEY, LAST_PLAYING_KEY]);
        } catch (error) {
            this.logger?.warn(`[Player] NetEase leveldb read failed: ${String(error)}`);
            return { track: null, reason: 'leveldb read failed' };
        }

        const lastPlaying = parseEncryptedJson<NeteaseLastPlayingJson>(values[LAST_PLAYING_KEY]);
        const lastPlayingId = normalizeId(lastPlaying?.trackId) || normalizeId(lastPlaying?.resourceId);
        const enrichedLastPlaying = lastPlaying ? { ...lastPlaying, updatedAt: Date.now() } : undefined;

        const playingInfo = parseEncryptedJson<NeteasePlayingInfoJson>(values[PLAYING_INFO_KEY]);
        if (playingInfo) {
            const result = parseNeteasePlayingInfo(playingInfo, enrichedLastPlaying, this.lastLiveState);
            if (result.track) {
                this.rememberLiveState(result.track, enrichedLastPlaying);
                return result;
            }
        }

        if (lastPlayingId) {
            const isPlaying = inferProgressIsPlaying(lastPlayingId, enrichedLastPlaying, this.lastLiveState);
            const result = await this.readTrackById(lastPlayingId, enrichedLastPlaying, isPlaying);
            if (result.track) {
                this.rememberLiveState(result.track, enrichedLastPlaying);
            }
            return result;
        }

        return { track: null, reason: 'live state missing' };
    }

    private async readTrackById(trackId: string, lastPlaying?: NeteaseLastPlayingJson, isPlaying = true): Promise<NeteaseHistoryResult> {
        if (!existsSync(this.dbPath)) {
            return { track: null, reason: 'database missing' };
        }
        if (!/^\d+$/.test(trackId)) {
            return { track: null, reason: 'unsupported track id' };
        }

        const directQueries = [
            `select jsonStr from historyTracks where id='${trackId}' order by playtime desc limit 1;`,
            `select jsonStr from dbTrack where id='${trackId}' limit 1;`,
            `select jsonStr from offlineTrack where id='${trackId}' limit 1;`,
        ];

        for (const query of directQueries) {
            const rows = await this.queryJson<SqliteJsonRow>(query);
            const track = findTrackJsonById(rows?.map((row) => row.jsonStr), trackId);
            if (track) {
                return buildNowPlaying(track, lastPlaying, 0, isPlaying);
            }
        }

        const cacheQuery = [
            'select jsonStr from requestCache',
            `where jsonStr like '%${trackId}%'`,
            'order by rowid desc limit 10;',
        ].join(' ');
        const cacheRows = await this.queryJson<SqliteJsonRow>(cacheQuery, 5000, REQUEST_CACHE_MAX_BUFFER);
        const cachedTrack = findTrackJsonById(cacheRows?.map((row) => row.jsonStr), trackId);
        if (cachedTrack) {
            return buildNowPlaying(cachedTrack, lastPlaying, 0, isPlaying);
        }

        const remoteTrack = await this.fetchTrackById(trackId);
        return remoteTrack ? buildNowPlaying(remoteTrack, lastPlaying, 0, isPlaying) : { track: null, reason: 'track metadata missing' };
    }

    private readLatestHistoryTrack(nowMs: number): Promise<NeteaseHistoryResult> {
        if (!existsSync(this.dbPath)) {
            return Promise.resolve({ track: null, reason: 'database missing' });
        }

        return new Promise((resolve) => {
            execFile(SQLITE_PATH, ['-readonly', '-json', this.dbPath, HISTORY_QUERY], { timeout: 2000 }, (err, stdout, stderr) => {
                if (err) {
                    this.logger?.warn(`[Player] NetEase sqlite query failed: ${err.message}; stderr=${stderr.trim()}`);
                    resolve({ track: null, reason: 'sqlite query failed' });
                    return;
                }
                resolve(parseNeteaseHistoryRows(stdout, nowMs));
            });
        });
    }

    private queryJson<T>(query: string, timeout = 2000, maxBuffer = 1024 * 1024): Promise<T[] | null> {
        return new Promise((resolve) => {
            execFile(SQLITE_PATH, ['-readonly', '-json', this.dbPath, query], { timeout, maxBuffer }, (err, stdout, stderr) => {
                if (err) {
                    this.logger?.warn(`[Player] NetEase sqlite query failed: ${err.message}; stderr=${stderr.trim()}`);
                    resolve(null);
                    return;
                }

                try {
                    resolve(JSON.parse(stdout || '[]') as T[]);
                } catch {
                    resolve(null);
                }
            });
        });
    }

    private async fetchTrackById(trackId: string): Promise<NeteaseTrackJson | undefined> {
        const url = `https://music.163.com/api/v3/song/detail?c=${encodeURIComponent(JSON.stringify([{ id: Number(trackId) }]))}`;
        try {
            const data = await requestJson<NeteaseSongDetailResponse>(url);
            return data.songs?.find((song) => normalizeId(song.id) === trackId);
        } catch (error) {
            this.logger?.warn(`[Player] NetEase song detail request failed: ${String(error)}`);
            return undefined;
        }
    }

    private rememberLiveState(track: NowPlaying, lastPlaying?: NeteaseLastPlayingJson): void {
        const trackId = normalizeId(lastPlaying?.trackId) || normalizeId(lastPlaying?.resourceId);
        const current = Number(lastPlaying?.current);
        if (!trackId || !Number.isFinite(current)) {
            return;
        }
        this.lastLiveState = {
            trackId,
            current,
            sampledAt: this.lastLiveState?.trackId === trackId && Math.abs(this.lastLiveState.current - current) <= 0.05
                ? this.lastLiveState.sampledAt
                : Date.now(),
        };
    }
}

export function defaultNeteaseDbPath(): string {
    return join(
        homedir(),
        'Library',
        'Containers',
        'com.netease.163music',
        'Data',
        'Documents',
        'storage',
        'sqlite_storage.sqlite3',
    );
}

export function defaultNeteaseLevelDbPath(): string {
    return join(
        homedir(),
        'Library',
        'Containers',
        'com.netease.163music',
        'Data',
        'Documents',
        'storage',
        'CEFCache',
        'Local Storage',
        'leveldb',
    );
}

export async function readNeteaseStorageValues(levelDbPath: string, keys: string[]): Promise<Record<string, string | undefined>> {
    const files = await readdir(levelDbPath, { withFileTypes: true });
    const candidates = await Promise.all(
        files
            .filter((file) => file.isFile() && /\.(?:log|ldb)$/.test(file.name))
            .map(async (file) => {
                const path = join(levelDbPath, file.name);
                const fileStat = await stat(path);
                const buffer = await readFile(path);
                return { path, mtimeMs: fileStat.mtimeMs, text: buffer.toString('latin1') };
            }),
    );

    candidates.sort((a, b) => a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path));

    const result: Record<string, string | undefined> = {};
    for (const file of candidates) {
        for (const key of keys) {
            const value = extractLatestEncryptedValue(file.text, key);
            if (value) {
                result[key] = value;
            }
        }
    }
    return result;
}

export function extractLatestEncryptedValue(text: string, key: string): string | undefined {
    let latest: string | undefined;
    let searchFrom = 0;

    while (searchFrom < text.length) {
        const keyIndex = text.indexOf(key, searchFrom);
        if (keyIndex < 0) {
            break;
        }

        const window = text.slice(keyIndex + key.length, keyIndex + key.length + 32_000);
        BASE64_CANDIDATE_RE.lastIndex = 0;
        const candidate = BASE64_CANDIDATE_RE.exec(window)?.[0];
        if (candidate) {
            latest = candidate;
        }
        searchFrom = keyIndex + key.length;
    }

    return latest;
}

export function decryptNeteaseStorageValue(value: string): string {
    const decipher = createDecipheriv('aes-128-ecb', NETEASE_STORAGE_KEY, null);
    return Buffer.concat([decipher.update(Buffer.from(value, 'base64')), decipher.final()]).toString('utf8');
}

export function parseNeteasePlayingInfo(
    data: NeteasePlayingInfoJson,
    lastPlaying?: NeteaseLastPlayingJson,
    previousState?: { trackId: string; current: number; sampledAt: number },
): NeteaseHistoryResult {
    const track = data.curPlaying?.track ?? data.curPlaying?.localTrack;
    if (!track) {
        return { track: null, reason: 'missing live track metadata' };
    }

    const lastPlayingId = normalizeId(lastPlaying?.trackId) || normalizeId(lastPlaying?.resourceId);
    const trackId = normalizeId(track.id)
        || normalizeId(data.curPlaying?.trackId)
        || normalizeId(data.curPlaying?.resourceId)
        || normalizeId(data.resourceTrackId)
        || normalizeId(data.onlineResourceId)
        || normalizeId(data.playId);
    if (lastPlayingId && trackId && lastPlayingId !== trackId) {
        return { track: null, reason: 'live track mismatch' };
    }

    const durationFallback = secondsToMs(data.resourceDuration);
    const progress = lastPlaying ?? { current: data.current, trackId };
    return buildNowPlaying(track, progress, durationFallback, inferIsPlaying(lastPlayingId || trackId, progress, data, previousState));
}

export function parseNeteaseHistoryRows(stdout: string, nowMs: number): NeteaseHistoryResult {
    let rows: SqliteHistoryRow[];
    try {
        rows = JSON.parse(stdout || '[]') as SqliteHistoryRow[];
    } catch {
        return { track: null, reason: 'invalid sqlite JSON' };
    }

    const row = rows[0];
    if (!row?.jsonStr) {
        return { track: null, reason: 'no history row' };
    }

    const playtime = Number(row.playtime);
    if (!Number.isFinite(playtime) || playtime <= 0) {
        return { track: null, reason: 'invalid playtime' };
    }

    let data: NeteaseTrackJson;
    try {
        data = JSON.parse(row.jsonStr) as NeteaseTrackJson;
    } catch {
        return { track: null, reason: 'invalid track JSON' };
    }

    const metadata = parseNeteaseTrackMetadata(data);
    if (!metadata.track) {
        return { track: null, reason: metadata.reason };
    }

    const elapsed = Math.max(0, nowMs - playtime);
    if (elapsed > metadata.track.duration + STALE_GRACE_MS) {
        return { track: null, reason: 'history row is stale' };
    }

    return {
        track: {
            title: metadata.track.title,
            artist: metadata.track.artist,
            album: metadata.track.album,
            duration: metadata.track.duration,
            position: Math.min(elapsed, metadata.track.duration),
            isPlaying: true,
            source: 'netease',
        },
    };
}

function parseEncryptedJson<T>(value?: string): T | undefined {
    if (!value) {
        return undefined;
    }

    try {
        return JSON.parse(decryptNeteaseStorageValue(value)) as T;
    } catch {
        return undefined;
    }
}

function buildNowPlaying(
    track: NeteaseTrackJson,
    lastPlaying?: NeteaseLastPlayingJson,
    durationFallback = 0,
    isPlaying = true,
): NeteaseHistoryResult {
    const metadata = parseNeteaseTrackMetadata(track, durationFallback);
    if (!metadata.track) {
        return { track: null, reason: metadata.reason };
    }

    const position = normalizePosition(lastPlaying?.current, metadata.track.duration);
    return {
        track: {
            title: metadata.track.title,
            artist: metadata.track.artist,
            album: metadata.track.album,
            duration: metadata.track.duration,
            position,
            isPlaying,
            source: 'netease',
        },
    };
}

function parseNeteaseTrackMetadata(
    data: NeteaseTrackJson,
    durationFallback = 0,
): { track?: NeteaseTrackMetadata; reason?: string } {
    const title = normalizeText(data.name);
    const artist = normalizeArtist(data);
    const album = normalizeText(data.album?.albumName)
        || normalizeText(data.album?.name)
        || normalizeText(data.al?.name);
    const duration = normalizeDuration(data.duration ?? data.dt, durationFallback);

    if (!title) {
        return { reason: 'missing title' };
    }
    if (!artist) {
        return { reason: 'missing artist' };
    }
    if (!Number.isFinite(duration) || duration <= 0) {
        return { reason: 'invalid duration' };
    }

    return {
        track: {
            id: normalizeId(data.id),
            title,
            artist,
            album,
            duration,
        },
    };
}

function findTrackJsonById(values: Array<string | undefined> | undefined, trackId: string): NeteaseTrackJson | undefined {
    for (const value of values ?? []) {
        const parsed = parseJsonLoose(value);
        const track = findTrackJsonInValue(parsed, trackId);
        if (track) {
            return track;
        }
    }
    return undefined;
}

function findTrackJsonInValue(value: unknown, trackId: string): NeteaseTrackJson | undefined {
    const stack: unknown[] = [value];
    let visited = 0;

    while (stack.length > 0 && visited < 20_000) {
        visited += 1;
        const current = stack.pop();
        if (!current) {
            continue;
        }

        if (typeof current === 'string') {
            stack.push(parseJsonLoose(current));
            continue;
        }

        if (Array.isArray(current)) {
            for (const item of current) {
                stack.push(item);
            }
            continue;
        }

        if (!isRecord(current)) {
            continue;
        }

        if (normalizeId(current.id) === trackId && typeof current.name === 'string') {
            return current as NeteaseTrackJson;
        }

        for (const child of Object.values(current)) {
            if (typeof child === 'object' || typeof child === 'string') {
                stack.push(child);
            }
        }
    }

    return undefined;
}

function parseJsonLoose(value: unknown): unknown {
    if (typeof value !== 'string' || !value.trim()) {
        return undefined;
    }

    try {
        return JSON.parse(value);
    } catch {
        return undefined;
    }
}

function normalizeArtist(data: NeteaseTrackJson): string {
    const artists = data.artists ?? data.ar;
    const artistList = Array.isArray(artists)
        ? artists.map((item) => normalizeText(item.name)).filter(Boolean)
        : [];
    return artistList.join(' / ') || normalizeText(data.artist);
}

function normalizeDuration(value: unknown, fallback = 0): number {
    const duration = Number(value);
    if (Number.isFinite(duration) && duration > 0) {
        return duration;
    }
    return fallback;
}

function normalizePosition(value: unknown, durationMs: number): number {
    const position = Number(value);
    if (!Number.isFinite(position) || position < 0) {
        return 0;
    }
    const durationSeconds = durationMs / 1000;
    const positionMs = position <= durationSeconds + 300 ? position * 1000 : position;
    return Math.min(positionMs, durationMs);
}

function inferIsPlaying(
    trackId: string | undefined,
    progress: NeteaseLastPlayingJson,
    playingInfo: NeteasePlayingInfoJson,
    previousState?: { trackId: string; current: number; sampledAt: number },
): boolean {
    const current = Number(progress.current);
    const progressPlaying = inferProgressIsPlaying(trackId, progress, previousState);
    if (progressPlaying !== undefined) {
        return progressPlaying;
    }

    const playingState = Number(playingInfo.playingState);
    return !Number.isFinite(playingState) || playingState === NETEASE_PLAYING_STATE;
}

function inferProgressIsPlaying(
    trackId: string | undefined,
    progress: NeteaseLastPlayingJson | undefined,
    previousState?: { trackId: string; current: number; sampledAt: number },
): boolean | undefined {
    const current = Number(progress?.current);
    if (!trackId || previousState?.trackId !== trackId || !Number.isFinite(current)) {
        return undefined;
    }
    if (current > previousState.current + 0.05) {
        return true;
    }
    if (Date.now() - previousState.sampledAt >= PAUSED_PROGRESS_STABLE_MS && Math.abs(current - previousState.current) <= 0.05) {
        return false;
    }
    return true;
}

function secondsToMs(value: unknown): number {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

function normalizeId(value: unknown): string | undefined {
    if (typeof value === 'string' && value.trim()) {
        return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    return undefined;
}

function normalizeText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function requestJson<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const req = request(
            url,
            {
                method: 'GET',
                headers: {
                    Referer: 'https://music.163.com',
                    'User-Agent': 'Mozilla/5.0',
                },
            },
            (res) => {
                let body = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => {
                    body += chunk;
                });
                res.on('end', () => {
                    if ((res.statusCode ?? 0) >= 400) {
                        reject(new Error(`HTTP ${res.statusCode}`));
                        return;
                    }

                    try {
                        resolve(JSON.parse(body) as T);
                    } catch (error) {
                        reject(error);
                    }
                });
            },
        );

        req.on('error', reject);
        req.setTimeout(5000, () => {
            req.destroy(new Error('request timeout'));
        });
        req.end();
    });
}
