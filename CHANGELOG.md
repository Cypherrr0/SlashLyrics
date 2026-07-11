# Changelog

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
