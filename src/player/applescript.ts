import type { PlayerBackend, NowPlaying } from './index';
import { execFile } from 'node:child_process';

const SPOTIFY_SCRIPT = `
tell application "System Events"
  if not (exists process "Spotify") then return "NOT_RUNNING"
end tell
tell application "Spotify"
  if player state is not playing then return "NOT_PLAYING"
  set t to name of current track
  set a to artist of current track
  set al to album of current track
  set d to duration of current track
  set p to player position
  return t & "\\n" & a & "\\n" & al & "\\n" & d & "\\n" & p
end tell`;

const MUSIC_SCRIPT = `
tell application "System Events"
  if not (exists process "Music") then return "NOT_RUNNING"
end tell
tell application "Music"
  if player state is not playing then return "NOT_PLAYING"
  set t to name of current track
  set a to artist of current track
  set al to album of current track
  set d to duration of current track
  set p to player position
  return t & "\\n" & a & "\\n" & al & "\\n" & d & "\\n" & p
end tell`;

export class AppleScriptBackend implements PlayerBackend {
    readonly name = 'applescript';

    async getNowPlaying(): Promise<NowPlaying | null> {
        const result = await this.tryScript(SPOTIFY_SCRIPT) ?? await this.tryScript(MUSIC_SCRIPT);
        return result;
    }

    private tryScript(script: string): Promise<NowPlaying | null> {
        return new Promise((resolve) => {
            execFile('osascript', ['-e', script], { timeout: 5000 }, (err, stdout) => {
                if (err) return resolve(null);
                const out = stdout.trim();
                if (out === 'NOT_RUNNING' || out === 'NOT_PLAYING' || !out) return resolve(null);

                const parts = out.split('\n');
                if (parts.length < 5) return resolve(null);

                resolve({
                    title: parts[0],
                    artist: parts[1],
                    album: parts[2],
                    duration: parseFloat(parts[3]) * 1000,
                    position: parseFloat(parts[4]) * 1000,
                    isPlaying: true,
                    source: 'applescript',
                });
            });
        });
    }
}
