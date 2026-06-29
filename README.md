# SlashLyrics

Display currently playing music lyrics as ghost comments in your code editor.

## Features

- Lyrics appear as faded italic text at the end of your current line — like a comment, but never modifies your code
- Supports any macOS music player that shows in Control Center (Spotify, Apple Music, NetEase Cloud Music, QQ Music, etc.)
- Time-synced LRC lyrics from NetEase Music and QQ Music
- Status bar shows current track info

## Usage

1. Install the extension
2. Play music in any supported player
3. Lyrics automatically appear in your editor

## Commands

- `SlashLyrics: Toggle` — Enable/disable lyrics display
- `SlashLyrics: Clear Cache` — Clear cached lyrics

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `slashlyrics.enabled` | `true` | Enable/disable |
| `slashlyrics.displayMode` | `cursor-line` | Where to show lyrics |
| `slashlyrics.color` | `#6b7280` | Lyric text color |
| `slashlyrics.prefix` | `♪ ` | Prefix before lyrics |
| `slashlyrics.showTranslation` | `false` | Show translated lyrics |
| `slashlyrics.providers` | `["netease", "qq"]` | Lyrics source priority |
| `slashlyrics.pollInterval` | `1000` | Polling interval (ms) |

## Requirements

- macOS (Windows/Linux support planned)
- A music player that integrates with macOS media controls

## License

MIT
