# Changelog

## [Unreleased]

### Fixed
- Recover the current NetEase track from CEF player artwork and the online playback cache when NetEase 3.0.20 local-storage encryption prevents decoding `playingInfo` and `lastPlaying`.
- Stop stale `historyTracks` rows from pinning the final lyric of an old song.
- Prevent overlapping asynchronous polls and discard results from stopped or restarted polling sessions.

### Changed
- Prefer the last successful player backend to avoid the MediaRemote timeout on every NetEase poll.
- Reduce the default polling interval from 1000 ms to 250 ms for more responsive lyric transitions.

## [0.1.7] - 2026-07-12

### Fixed
- Added a NetEase Cloud Music local-state backend that reads encrypted `playingInfo` and `lastPlaying` data when macOS MediaRemote no longer exposes NetEase now-playing metadata.
- Kept lyric position in sync with NetEase seek and pause state by using the local `lastPlaying.current` value and guarding against stale `playingInfo` metadata.
- Preferred actively playing backends over paused fallback results so Apple Music can take over after NetEase is paused.
- Returned paused Apple Music and Spotify track metadata instead of dropping the AppleScript backend result.

## [0.1.6] - 2026-07-11

### Changed
- Extended Now Playing diagnostics with MediaRemote client bundle identifiers, display name, and current application PID to identify which app macOS reports as the active media client.
- Listen for both known MediaRemote playing-state notification names when collecting Now Playing diagnostics.

## [0.1.5] - 2026-07-11

### Added
- Added `SlashLyrics: Diagnose Now Playing`, which runs the packaged MediaRemote helper, opens the SlashLyrics output channel, and copies the raw diagnostic report to the clipboard.

### Changed
- Log MediaRemote helper failures instead of silently falling back, so missing helpers, execution errors, empty output, and invalid JSON are visible in the SlashLyrics output channel.

## [0.1.4] - 2026-07-11

### Fixed
- Reworked the macOS MediaRemote helper to register Now Playing notifications before reading metadata, matching the approach used by LyricsX's MusicPlayer backend.
- Packaged the macOS helper as a universal binary so both Apple Silicon and Intel Macs can capture system Now Playing metadata.

## [0.1.3] - 2026-07-11

### Fixed
- Improved macOS Now Playing capture for players whose MediaRemote playback flag is unreliable, including NetEase Cloud Music and QQ Music.

## [0.1.2] - 2026-07-02

### Fixed
- Added the macOS MediaRemote helper build step so release packages can include `bin/nowplaying-helper`.
- Updated Marketplace metadata with public package settings and the correct GitHub repository URL.
- Updated README install and release links to point at the latest packaged version.
- Aligned translated lyrics with original lyrics even when the two editor lines have different code lengths.

## [0.1.1] - 2026-07-02

### Added
- Cursor-following lyric display that refreshes ghost comments as the active selection changes.
- Optional translated lyric display using available NetEase and QQ translation data.
- `slashlyrics.showColor` setting to switch between configured lyric color and editor default foreground.

### Changed
- Refreshed README hero branding and packaged README image assets.
- Tightened VSIX packaging excludes for generated build artifacts.

## [0.1.0] - 2026-06-23

### Added
- Initial MVP release
- Detect currently playing music via MediaRemote (macOS) with AppleScript fallback
- Fetch lyrics from NetEase Music and QQ Music APIs
- Display lyrics as ghost comments via VSCode Decorations API
- Status bar showing current track info
- LRC time-synced lyrics parsing
- Local lyrics cache (~/.slashlyrics/cache/)
- Commands: Toggle, Search Lyrics, Clear Cache
