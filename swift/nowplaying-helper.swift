import Foundation

// Dynamically load MediaRemote.framework
guard let bundle = CFBundleCreate(
    kCFAllocatorDefault,
    NSURL(fileURLWithPath: "/System/Library/PrivateFrameworks/MediaRemote.framework")
) else {
    printJSON(["error": "Failed to load MediaRemote.framework"])
    exit(1)
}

// Get function pointers
typealias MRMediaRemoteGetNowPlayingInfoFunc = @convention(c)
    (DispatchQueue, @escaping ([String: Any]) -> Void) -> Void

guard let getInfoPtr = CFBundleGetFunctionPointerForName(
    bundle, "MRMediaRemoteGetNowPlayingInfo" as CFString
) else {
    printJSON(["error": "MRMediaRemoteGetNowPlayingInfo not found"])
    exit(1)
}

let MRMediaRemoteGetNowPlayingInfo = unsafeBitCast(
    getInfoPtr, to: MRMediaRemoteGetNowPlayingInfoFunc.self
)

// Some players expose metadata but return an unreliable global playing flag.
MRMediaRemoteGetNowPlayingInfo(DispatchQueue.main) { info in
    let title = stringValue(info, "kMRMediaRemoteNowPlayingInfoTitle")
    let artist = stringValue(info, "kMRMediaRemoteNowPlayingInfoArtist")
    let album = stringValue(info, "kMRMediaRemoteNowPlayingInfoAlbum")
    let duration = doubleValue(info, "kMRMediaRemoteNowPlayingInfoDuration")
    let elapsed = doubleValue(info, "kMRMediaRemoteNowPlayingInfoElapsedTime")
    let playbackRate = optionalDoubleValue(info, "kMRMediaRemoteNowPlayingInfoPlaybackRate")

    guard !title.isEmpty else {
        printJSON(["isPlaying": false])
        exit(0)
    }

    let result: [String: Any] = [
        "title": title,
        "artist": artist,
        "album": album,
        "duration": duration * 1000,
        "position": elapsed * 1000,
        "isPlaying": playbackRate.map { $0 != 0 } ?? true
    ]

    printJSON(result)
    exit(0)
}

func stringValue(_ dict: [String: Any], _ key: String) -> String {
    if let value = dict[key] as? String {
        return value.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    return ""
}

func doubleValue(_ dict: [String: Any], _ key: String) -> Double {
    return optionalDoubleValue(dict, key) ?? 0
}

func optionalDoubleValue(_ dict: [String: Any], _ key: String) -> Double? {
    if let value = dict[key] as? Double {
        return value
    }
    if let value = dict[key] as? NSNumber {
        return value.doubleValue
    }
    if let value = dict[key] as? String, let parsed = Double(value) {
        return parsed
    }
    return nil
}

func printJSON(_ dict: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: dict, options: []),
       let str = String(data: data, encoding: .utf8) {
        print(str)
    }
}

// Keep run loop alive for async callbacks
RunLoop.main.run(until: Date(timeIntervalSinceNow: 3))
