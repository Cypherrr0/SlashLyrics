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
typealias MRMediaRemoteGetNowPlayingApplicationIsPlayingFunc = @convention(c)
    (DispatchQueue, @escaping (Bool) -> Void) -> Void

guard let getInfoPtr = CFBundleGetFunctionPointerForName(
    bundle, "MRMediaRemoteGetNowPlayingInfo" as CFString
) else {
    printJSON(["error": "MRMediaRemoteGetNowPlayingInfo not found"])
    exit(1)
}

guard let isPlayingPtr = CFBundleGetFunctionPointerForName(
    bundle, "MRMediaRemoteGetNowPlayingApplicationIsPlaying" as CFString
) else {
    printJSON(["error": "MRMediaRemoteGetNowPlayingApplicationIsPlaying not found"])
    exit(1)
}

let MRMediaRemoteGetNowPlayingInfo = unsafeBitCast(
    getInfoPtr, to: MRMediaRemoteGetNowPlayingInfoFunc.self
)
let MRMediaRemoteGetNowPlayingApplicationIsPlaying = unsafeBitCast(
    isPlayingPtr, to: MRMediaRemoteGetNowPlayingApplicationIsPlayingFunc.self
)

// Check if playing first
MRMediaRemoteGetNowPlayingApplicationIsPlaying(DispatchQueue.main) { isPlaying in
    guard isPlaying else {
        printJSON(["isPlaying": false])
        exit(0)
    }

    MRMediaRemoteGetNowPlayingInfo(DispatchQueue.main) { info in
        let title = info["kMRMediaRemoteNowPlayingInfoTitle"] as? String ?? ""
        let artist = info["kMRMediaRemoteNowPlayingInfoArtist"] as? String ?? ""
        let album = info["kMRMediaRemoteNowPlayingInfoAlbum"] as? String ?? ""
        let duration = info["kMRMediaRemoteNowPlayingInfoDuration"] as? Double ?? 0
        let elapsed = info["kMRMediaRemoteNowPlayingInfoElapsedTime"] as? Double ?? 0

        let result: [String: Any] = [
            "title": title,
            "artist": artist,
            "album": album,
            "duration": duration * 1000,
            "position": elapsed * 1000,
            "isPlaying": true
        ]

        printJSON(result)
        exit(0)
    }
}

func printJSON(_ dict: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: dict, options: []),
       let str = String(data: data, encoding: .utf8) {
        print(str)
    }
}

// Keep run loop alive for async callbacks
RunLoop.main.run(until: Date(timeIntervalSinceNow: 3))
