# Changelog

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
