# Changelog

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
