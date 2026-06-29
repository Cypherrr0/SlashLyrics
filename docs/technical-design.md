# SlashLyrics 技术设计方案

## 1. 项目概述

### 1.1 产品定位

SlashLyrics 是一个 VSCode 扩展，将当前正在播放的音乐歌词以「幽灵注释」的形式显示在代码编辑器中，让开发者在编码时可以看到歌词，同时不修改任何源代码文件。

### 1.2 核心体验

- 歌词以灰色斜体文本显示在当前光标所在行末尾，外观类似 `// ♪ 歌词内容`
- 歌词随播放进度自动切换，支持 LRC 时间同步
- 文件 buffer 完全不变，git diff 无任何影响
- 状态栏显示当前曲目信息

### 1.3 技术栈

| 层 | 选型 | 说明 |
|---|------|------|
| 扩展宿主 | VSCode Extension API | TypeScript |
| 运行时 | Node.js | 扩展进程内运行 |
| 工程脚手架 | awesome-vscode-extension-boilerplate | esbuild 打包 + pnpm + ESLint + Prettier + CI/CD |
| 播放器检测（主） | MediaRemote.framework | macOS 私有框架，通过 Swift helper 调用，支持所有播放器 |
| 播放器检测（备） | osascript (AppleScript) | Fallback，获取特定 app 的额外信息 |
| 歌词获取 | HTTP API | 网易云音乐 / QQ 音乐 |
| 歌词解析 | 自实现 LRC parser | 轻量，无外部依赖 |
| 歌词显示 | VSCode Decorations API | `after` render option |

### 1.4 平台支持

- Phase 1: macOS（**全局 MediaRemote** — 支持所有在控制中心「正在播放」里的 app）
- Phase 2: Windows（Spotify Web API + System Media Transport Controls）
- Phase 3: Linux（MPRIS D-Bus）

### 1.5 支持的播放器（macOS Phase 1）

通过 MediaRemote.framework 实现全局检测，**无需逐一适配**，只要 app 集成了 macOS 媒体控制（在控制中心「正在播放」可见）即可自动捕获：

| 播放器 | 支持状态 |
|--------|----------|
| Apple Music | ✅ 原生支持 |
| Spotify | ✅ 原生支持 |
| 网易云音乐 | ✅ Mac 版集成系统媒体控制 |
| QQ 音乐 | ✅ Mac 版集成系统媒体控制 |
| 酷狗音乐 | ✅ Mac 版集成系统媒体控制 |
| VLC | ✅ 支持 |
| 浏览器（Chrome/Safari） | ✅ 浏览器自动发布 Now Playing（YouTube、B站等） |
| 汽水音乐 | ⚠️ 待验证（如有 Mac 原生 app 且显示在控制中心则支持） |

---

## 2. 系统架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────┐
│                   VSCode Extension                   │
│          (awesome-vscode-extension-boilerplate)       │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─────────────┐   ┌────────────┐   ┌────────────┐ │
│  │   Player     │──▶│   Lyrics   │──▶│  Display   │ │
│  │   Monitor    │   │   Manager  │   │  Engine    │ │
│  └──────┬──────┘   └────────────┘   └────────────┘ │
│         │                │                │         │
│    ┌────┴────┐    ┌──────┴─────┐   ┌──────┴─────┐  │
│    │MediaRe- │    │ LRC Parser │   │Decorations │  │
│    │mote     │    │ + Cache    │   │+ StatusBar │  │
│    │Helper   │    └────────────┘   └────────────┘  │
│    │(Swift)  │                                      │
│    └────┬────┘                                      │
│         │                                           │
│    ┌────┴────┐                                      │
│    │osascript│ (fallback)                           │
│    │ bridge  │                                      │
│    └─────────┘                                      │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 2.2 模块职责

| 模块 | 职责 |
|------|------|
| **PlayerMonitor** | 检测当前播放状态（曲目、进度、播放/暂停） |
| **LyricsManager** | 根据曲目信息搜索歌词，管理缓存 |
| **LRCParser** | 解析 LRC/LRCX 格式为结构化数据 |
| **DisplayEngine** | 将歌词渲染到编辑器（Decorations）和状态栏 |
| **ConfigManager** | 用户配置管理 |

---

## 3. 播放器检测（PlayerMonitor）

### 3.1 macOS 主方案：MediaRemote.framework（全局检测）

MediaRemote 是 macOS 的私有框架（`/System/Library/PrivateFrameworks/MediaRemote.framework`），是控制中心、Touch Bar「正在播放」的底层 API。通过它可以检测**任何**集成了系统媒体控制的 app 的播放状态，无需逐一适配。

**实现方式：Swift Helper CLI**

由于 MediaRemote 是 Objective-C/Swift 框架，无法直接从 Node.js 调用。方案是编译一个轻量 Swift 命令行工具，VSCode 扩展通过 `child_process` 调用。

```swift
// nowplaying-helper.swift
import Foundation

// 动态加载 MediaRemote.framework
let bundle = CFBundleCreate(kCFAllocatorDefault,
    NSURL(fileURLWithPath: "/System/Library/PrivateFrameworks/MediaRemote.framework"))

// 获取函数指针
typealias MRMediaRemoteGetNowPlayingInfoFunction = @convention(c)
    (DispatchQueue, @escaping ([String: Any]) -> Void) -> Void

let MRMediaRemoteGetNowPlayingInfo = unsafeBitCast(
    CFBundleGetFunctionPointerForName(bundle, "MRMediaRemoteGetNowPlayingInfo" as CFString),
    to: MRMediaRemoteGetNowPlayingInfoFunction.self
)

// 获取当前播放信息
MRMediaRemoteGetNowPlayingInfo(DispatchQueue.main) { info in
    let title = info["kMRMediaRemoteNowPlayingInfoTitle"] as? String ?? ""
    let artist = info["kMRMediaRemoteNowPlayingInfoArtist"] as? String ?? ""
    let album = info["kMRMediaRemoteNowPlayingInfoAlbum"] as? String ?? ""
    let duration = info["kMRMediaRemoteNowPlayingInfoDuration"] as? Double ?? 0
    let elapsed = info["kMRMediaRemoteNowPlayingInfoElapsedTime"] as? Double ?? 0

    // 输出 JSON 供 Node.js 解析
    let json: [String: Any] = [
        "title": title, "artist": artist, "album": album,
        "duration": duration * 1000, "position": elapsed * 1000,
        "isPlaying": true
    ]
    if let data = try? JSONSerialization.data(withJSONObject: json),
       let str = String(data: data, encoding: .utf8) {
        print(str)
    }
    exit(0)
}

RunLoop.main.run(until: Date(timeIntervalSinceNow: 2))
```

**Node.js 调用：**

```typescript
import { execFile } from 'child_process';
import { join } from 'path';

function getNowPlaying(): Promise<NowPlaying | null> {
  const helperPath = join(__dirname, '..', 'bin', 'nowplaying-helper');
  return new Promise((resolve) => {
    execFile(helperPath, { timeout: 3000 }, (err, stdout) => {
      if (err || !stdout.trim()) return resolve(null);
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve(null);
      }
    });
  });
}
```

### 3.2 macOS 备用方案：AppleScript Bridge

当 MediaRemote Helper 不可用时（如未编译），降级为 AppleScript 方案，仅支持 Spotify 和 Apple Music。

```applescript
tell application "Spotify"
  if player state is playing then
    set trackName to name of current track
    set trackArtist to artist of current track
    set trackDuration to duration of current track
    set trackPosition to player position
    return trackName & "\n" & trackArtist & "\n" & trackDuration & "\n" & trackPosition
  end if
end tell
```

### 3.5 轮询间隔

| 场景 | 轮询间隔 | 说明 |
|------|----------|------|
| 正在播放 | 1000ms | 用于歌词时间同步 |
| 暂停/无播放 | 5000ms | 降低资源消耗 |
| 编辑器失焦 | 暂停轮询 | 节省 CPU |

### 3.6 数据模型

```typescript
interface NowPlaying {
  title: string;
  artist: string;
  album: string;
  duration: number;    // 毫秒
  position: number;    // 当前播放位置，毫秒
  isPlaying: boolean;
  source: 'mediaremote' | 'applescript';
}
```

### 3.7 切歌检测

通过比较前后两次轮询的 `title + artist` 判断是否切歌。切歌时触发歌词重新搜索。

---

## 4. 歌词获取（LyricsManager）

### 4.1 歌词源优先级

```
网易云音乐 API → QQ 音乐 API → 本地缓存 .lrc 文件
```

多源并行请求，取质量最高的结果。

### 4.2 网易云音乐 API

```typescript
// 搜索歌曲
const searchUrl = `https://music.163.com/api/search/get?s=${encodeURIComponent(query)}&type=1&limit=5`;

// 获取歌词
const lyricUrl = `https://music.163.com/api/song/lyric?id=${songId}&lv=1&tv=1`;
```

返回格式：
- `lrc.lyric`: 原文歌词（LRC 格式）
- `tlyric.lyric`: 翻译歌词（LRC 格式）

### 4.3 QQ 音乐 API

```typescript
// 搜索歌曲
const searchUrl = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${encodeURIComponent(query)}&format=json&p=1&n=5`;

// 获取歌词（base64 编码）
const lyricUrl = `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${mid}&format=json`;
```

### 4.4 歌词匹配策略

```typescript
function matchLyrics(track: NowPlaying, candidates: LyricsResult[]): LyricsResult | null {
  return candidates
    .filter(c => {
      // 标题相似度 > 0.8
      const titleSim = similarity(c.title, track.title);
      // 时长差异 < 3秒
      const durationDiff = Math.abs(c.duration - track.duration);
      return titleSim > 0.8 && durationDiff < 3000;
    })
    .sort((a, b) => b.quality - a.quality)[0] ?? null;
}
```

### 4.5 缓存策略

```
~/.slashlyrics/cache/
├── {md5(title+artist)}.lrc    # 原文歌词
├── {md5(title+artist)}.tlrc   # 翻译歌词
└── index.json                  # 缓存索引
```

- 缓存命中：直接使用，不发网络请求
- 缓存有效期：30 天
- 最大缓存：500 首

---

## 5. LRC 解析（LRCParser）

### 5.1 LRC 格式

```
[ti:歌曲名]
[ar:歌手名]
[al:专辑名]
[offset:+/- 毫秒偏移]
[00:12.34]第一行歌词
[00:15.67]第二行歌词
```

### 5.2 数据结构

```typescript
interface LyricsLine {
  time: number;       // 毫秒
  text: string;       // 歌词文本
  translation?: string; // 翻译
}

interface Lyrics {
  title?: string;
  artist?: string;
  offset: number;
  lines: LyricsLine[];
}
```

### 5.3 当前行定位

```typescript
function getCurrentLine(lyrics: Lyrics, position: number): number {
  const adjusted = position + lyrics.offset;
  // 二分查找最后一个 time <= adjusted 的行
  let lo = 0, hi = lyrics.lines.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lyrics.lines[mid].time <= adjusted) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi;
}
```

---

## 6. 歌词显示（DisplayEngine）

### 6.1 核心方案：Decorations API

VSCode 的 `TextEditorDecorationType` 支持在代码行末尾渲染额外文本，且不修改文档内容。

```typescript
const lyricDecoration = vscode.window.createTextEditorDecorationType({
  after: {
    margin: '0 0 0 2em',
    fontStyle: 'italic',
    color: new vscode.ThemeColor('slashlyrics.lyricColor'),
  },
  isWholeLine: true,
});
```

### 6.2 显示位置策略

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| **cursor-line** (默认) | 歌词显示在光标所在行末尾 | 专注编码时 |
| **top-line** | 歌词显示在可视区域第一行末尾 | 阅读代码时 |
| **fixed-line** | 用户指定固定行号 | 个人偏好 |

### 6.3 显示内容格式

```
// 默认格式
const x = 1;  ♪ 我曾将青春翻涌成她

// 带翻译
const x = 1;  ♪ Yesterday once more | 昨日重现

// 纯英文
const x = 1;  ♪ Never gonna give you up
```

### 6.4 状态栏

```typescript
const statusBar = vscode.window.createStatusBarItem(
  vscode.StatusBarAlignment.Right, 100
);
statusBar.text = '$(music) Artist - Title';
statusBar.tooltip = '点击打开歌词面板';
statusBar.command = 'slashlyrics.showPanel';
```

### 6.5 可选：Webview 歌词面板

侧边栏 Webview 显示完整歌词，高亮当前行，支持点击跳转。作为 v1.1 功能。

---

## 7. 日志方案

### 7.1 日志通道

使用 VSCode 内置的 `LogOutputChannel`（VSCode 1.74+），提供结构化日志级别和自动时间戳。

```typescript
const logger = vscode.window.createOutputChannel('SlashLyrics', { log: true });
```

用户可在 VSCode 面板「输出」→ 下拉选择「SlashLyrics」查看日志。

### 7.2 日志级别

| 级别 | 方法 | 用途 | 示例 |
|------|------|------|------|
| Trace | `logger.trace()` | 极详细的调试信息 | 每次轮询的原始 JSON 返回 |
| Debug | `logger.debug()` | 开发调试信息 | 歌词搜索请求 URL、匹配评分 |
| Info | `logger.info()` | 正常运行状态 | 切歌、歌词加载成功、扩展启动/停止 |
| Warn | `logger.warn()` | 可恢复的异常 | 某歌词源超时但有 fallback、缓存失效 |
| Error | `logger.error()` | 不可恢复的错误 | MediaRemote helper 启动失败、所有歌词源均失败 |

用户通过 VSCode 命令面板 `Developer: Set Log Level` 控制日志详细程度，默认 Info。

### 7.3 各模块日志规范

**PlayerMonitor：**
```typescript
logger.info(`[Player] Now playing: ${title} - ${artist}`);
logger.debug(`[Player] Position: ${position}ms / ${duration}ms`);
logger.trace(`[Player] Raw MediaRemote response: ${JSON.stringify(info)}`);
logger.warn(`[Player] MediaRemote unavailable, falling back to AppleScript`);
logger.error(`[Player] All detection methods failed`);
```

**LyricsManager：**
```typescript
logger.info(`[Lyrics] Loaded lyrics for "${title}" from netease (${lines.length} lines)`);
logger.debug(`[Lyrics] Searching: netease query="${query}"`);
logger.debug(`[Lyrics] Match score: title=${titleSim.toFixed(2)}, duration_diff=${diff}ms`);
logger.warn(`[Lyrics] Netease timeout after 5s, trying QQ Music`);
logger.info(`[Lyrics] Cache hit for "${title}" - ${artist}`);
```

**DisplayEngine：**
```typescript
logger.debug(`[Display] Showing line ${index}: "${text}"`);
logger.trace(`[Display] Decoration applied at line ${line}, col ${col}`);
```

### 7.4 用户通知

日志用于调试和诊断，用户可见的消息使用 VSCode 通知 API：

```typescript
// 仅在需要用户操作时弹通知
vscode.window.showWarningMessage('SlashLyrics: 未检测到正在播放的音乐');
vscode.window.showErrorMessage('SlashLyrics: MediaRemote 初始化失败，请检查系统权限');
vscode.window.showInformationMessage('SlashLyrics: 已连接到 Spotify');
```

通知原则：
- **不弹**：正常切歌、歌词加载成功等常规操作
- **Info 弹**：首次连接播放器成功
- **Warn 弹**：找不到歌词（允许手动搜索）
- **Error 弹**：需要用户干预的错误（权限、helper 缺失）

### 7.5 性能日志

关键路径记录耗时，便于性能优化：

```typescript
const start = performance.now();
const nowPlaying = await getNowPlaying();
logger.debug(`[Perf] getNowPlaying: ${(performance.now() - start).toFixed(1)}ms`);

const lyricsStart = performance.now();
const lyrics = await searchLyrics(title, artist);
logger.debug(`[Perf] searchLyrics: ${(performance.now() - lyricsStart).toFixed(1)}ms`);
```

### 7.6 日志输出示例

```
2026-06-23 15:30:01.123 [info]  [Player] Now playing: 晴天 - 周杰伦
2026-06-23 15:30:01.456 [debug] [Perf] getNowPlaying: 12.3ms
2026-06-23 15:30:01.789 [debug] [Lyrics] Searching: netease query="晴天 周杰伦"
2026-06-23 15:30:02.123 [debug] [Lyrics] Match score: title=0.95, duration_diff=200ms
2026-06-23 15:30:02.124 [info]  [Lyrics] Loaded lyrics for "晴天" from netease (42 lines)
2026-06-23 15:30:02.125 [debug] [Perf] searchLyrics: 336.1ms
2026-06-23 15:30:02.126 [debug] [Display] Showing line 0: "故事的小黄花"
```

---

## 8. 用户配置

### 8.1 配置项

```jsonc
{
  // 是否启用
  "slashlyrics.enabled": true,

  // 显示位置模式
  "slashlyrics.displayMode": "cursor-line",

  // 歌词颜色（支持主题色引用）
  "slashlyrics.color": "#6b7280",

  // 歌词前缀
  "slashlyrics.prefix": "♪ ",

  // 是否显示翻译
  "slashlyrics.showTranslation": false,

  // 翻译分隔符
  "slashlyrics.translationSeparator": " | ",

  // 首选播放器
  "slashlyrics.preferredPlayer": "auto",

  // 歌词源优先级
  "slashlyrics.providers": ["netease", "qq"],

  // 轮询间隔（ms）
  "slashlyrics.pollInterval": 1000,

  // 是否在编辑器失焦时暂停
  "slashlyrics.pauseOnBlur": false
}
```

### 8.2 命令面板

| 命令 | 说明 |
|------|------|
| `SlashLyrics: Toggle` | 开关歌词显示 |
| `SlashLyrics: Show Panel` | 打开歌词侧边栏 |
| `SlashLyrics: Search Lyrics` | 手动搜索歌词 |
| `SlashLyrics: Adjust Offset` | 调整歌词时间偏移 |
| `SlashLyrics: Clear Cache` | 清除歌词缓存 |

---

## 9. 项目结构

```
SlashLyrics/
├── scripts/                    # esbuild 构建脚本（boilerplate 自带）
│   └── esbuild.ts
├── src/
│   ├── extension.ts            # 扩展入口，激活/停用
│   ├── player/
│   │   ├── index.ts            # PlayerMonitor 接口 + 工厂
│   │   ├── mediaremote.ts      # MediaRemote helper 调用（主方案）
│   │   └── applescript.ts      # AppleScript fallback
│   ├── lyrics/
│   │   ├── manager.ts          # LyricsManager：搜索、缓存
│   │   ├── parser.ts           # LRC 解析器
│   │   └── providers/
│   │       ├── netease.ts      # 网易云音乐
│   │       └── qq.ts           # QQ 音乐
│   ├── display/
│   │   ├── decoration.ts       # Decorations 渲染
│   │   ├── statusbar.ts        # 状态栏
│   │   └── panel.ts            # Webview 面板（v1.1）
│   └── utils/
│       ├── config.ts           # 配置管理
│       ├── cache.ts            # 文件缓存
│       └── similarity.ts       # 字符串相似度
├── swift/
│   ├── nowplaying-helper.swift # MediaRemote Swift helper 源码
│   └── Makefile                # 编译脚本（swiftc → bin/）
├── bin/
│   └── nowplaying-helper       # 编译后的 Swift 二进制（.gitignore）
├── assets/
│   └── icon.png
├── test/
│   └── ...                     # 测试文件（boilerplate 自带结构）
├── package.json                # 扩展 manifest（pnpm）
├── tsconfig.base.json          # TypeScript 配置（boilerplate 自带）
├── .eslintrc                   # ESLint 配置
├── .prettierrc                 # Prettier 配置
├── .vscodeignore
├── .github/
│   └── workflows/              # CI/CD 自动发布（boilerplate 自带）
├── CHANGELOG.md
└── README.md
```

---

## 10. 开发计划

### v0.1 - MVP

- [ ] 基于 awesome-vscode-extension-boilerplate 搭建项目
- [ ] Swift MediaRemote helper 编译 + Node.js 调用
- [ ] AppleScript fallback（Spotify + Apple Music）
- [ ] 网易云音乐歌词搜索 + LRC 解析
- [ ] Decorations 显示歌词（cursor-line 模式）
- [ ] 状态栏显示曲目

### v0.2 - 体验优化

- [ ] QQ 音乐歌词源
- [ ] 歌词缓存
- [ ] 翻译歌词支持
- [ ] 多种显示位置模式
- [ ] 配置项完善

### v1.0 - 正式发布

- [ ] Webview 歌词面板
- [ ] 手动搜索/纠正歌词
- [ ] 时间偏移调整
- [ ] 扩展图标和 Marketplace 发布

### v1.1+ - 未来

- [ ] Windows 支持（Spotify Web API + System Media Transport Controls）
- [ ] Linux 支持（MPRIS D-Bus）
- [ ] 终端模式（独立 CLI 工具）
- [ ] 更多歌词源（Genius 等）

---

## 11. 风险与决策

| 风险 | 影响 | 应对 |
|------|------|------|
| 网易云 API 可能不稳定/被封 | 无法获取歌词 | 多源兜底 + 本地缓存 |
| MediaRemote 是私有 API | 不能上 Mac App Store | VSCode 扩展不走 App Store，无影响 |
| MediaRemote API 变更 | macOS 大版本更新后可能失效 | AppleScript fallback + 社区跟进 |
| Swift helper 需预编译 | 用户需要 Xcode/Swift 环境或下载预编译包 | CI 预编译 arm64/x86_64 二进制，随扩展分发 |
| macOS 权限问题 | 无法访问播放器 | 引导用户授权自动化权限 |
| Decorations 闪烁 | 视觉体验差 | 只在行切换时更新，不频繁重绘 |
| 歌词匹配不准 | 显示错误歌词 | 相似度 + 时长双重校验，允许手动纠正 |
