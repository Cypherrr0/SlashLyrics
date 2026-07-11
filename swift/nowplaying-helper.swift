import Darwin
import Foundation

private let mediaRemotePath = "/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote"
private let updateQueue = DispatchQueue(label: "slashlyrics.mediaremote.update")
private let finishLock = NSLock()

private var didFinish = false
private var latestInfo: NSDictionary?
private var systemPlaybackState: Int?

typealias MRMediaRemoteGetNowPlayingInfoFunc = @convention(c)
    (DispatchQueue, @escaping (CFDictionary?) -> Void) -> Void
typealias MRMediaRemoteGetNowPlayingApplicationIsPlayingFunc = @convention(c)
    (DispatchQueue, @escaping (Bool) -> Void) -> Void
typealias MRMediaRemoteRegisterForNowPlayingNotificationsFunc = @convention(c)
    (DispatchQueue) -> Void
typealias MRMediaRemoteUnregisterForNowPlayingNotificationsFunc = @convention(c)
    () -> Void

guard let mediaRemote = dlopen(mediaRemotePath, RTLD_LAZY) else {
    let message = dlerror().map { String(cString: $0) } ?? "unknown error"
    printJSON(["error": "Failed to load MediaRemote.framework: \(message)"])
    exit(1)
}

guard let getNowPlayingInfo = loadSymbol(
    "MRMediaRemoteGetNowPlayingInfo",
    as: MRMediaRemoteGetNowPlayingInfoFunc.self
) else {
    printJSON(["error": "MRMediaRemoteGetNowPlayingInfo not found"])
    exit(1)
}

let getNowPlayingApplicationIsPlaying = loadSymbol(
    "MRMediaRemoteGetNowPlayingApplicationIsPlaying",
    as: MRMediaRemoteGetNowPlayingApplicationIsPlayingFunc.self
)
let registerForNowPlayingNotifications = loadSymbol(
    "MRMediaRemoteRegisterForNowPlayingNotifications",
    as: MRMediaRemoteRegisterForNowPlayingNotificationsFunc.self
)
let unregisterForNowPlayingNotifications = loadSymbol(
    "MRMediaRemoteUnregisterForNowPlayingNotifications",
    as: MRMediaRemoteUnregisterForNowPlayingNotificationsFunc.self
)

registerForNowPlayingNotifications?(updateQueue)

let notificationCenter = NotificationCenter.default
let infoObserver = notificationCenter.addObserver(
    forName: Notification.Name("kMRMediaRemoteNowPlayingInfoDidChangeNotification"),
    object: nil,
    queue: nil
) { _ in
    requestNowPlayingInfo()
}
let stateObserver = notificationCenter.addObserver(
    forName: Notification.Name("kMRMediaRemoteNowPlayingApplicationPlaybackStateDidChangeNotification"),
    object: nil,
    queue: nil
) { notification in
    if let state = notification.userInfo?["kMRMediaRemotePlaybackStateUserInfoKey"] as? Int {
        systemPlaybackState = state
    }
    requestNowPlayingInfo()
}

getNowPlayingApplicationIsPlaying?(updateQueue) { isPlaying in
    systemPlaybackState = isPlaying ? 1 : nil
    requestNowPlayingInfo()
}

requestNowPlayingInfo()
for delay in [0.15, 0.5, 1.0] {
    DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
        requestNowPlayingInfo()
    }
}
DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
    finish(with: latestInfo)
}

RunLoop.main.run()

private func requestNowPlayingInfo() {
    getNowPlayingInfo(updateQueue) { info in
        guard let info else {
            return
        }

        let dict = info as NSDictionary
        latestInfo = dict

        if !stringValue(dict, "kMRMediaRemoteNowPlayingInfoTitle").isEmpty {
            finish(with: dict)
        }
    }
}

private func finish(with dict: NSDictionary?) {
    finishLock.lock()
    if didFinish {
        finishLock.unlock()
        return
    }
    didFinish = true
    finishLock.unlock()

    notificationCenter.removeObserver(infoObserver)
    notificationCenter.removeObserver(stateObserver)
    unregisterForNowPlayingNotifications?()
    dlclose(mediaRemote)

    guard let dict else {
        printJSON(["isPlaying": false])
        exit(0)
    }

    let title = stringValue(dict, "kMRMediaRemoteNowPlayingInfoTitle")
    guard !title.isEmpty else {
        printJSON(["isPlaying": false])
        exit(0)
    }

    let artist = stringValue(dict, "kMRMediaRemoteNowPlayingInfoArtist")
    let album = stringValue(dict, "kMRMediaRemoteNowPlayingInfoAlbum")
    let duration = doubleValue(dict, "kMRMediaRemoteNowPlayingInfoDuration")
    let elapsed = doubleValue(dict, "kMRMediaRemoteNowPlayingInfoElapsedTime")
    let playbackRate = optionalDoubleValue(dict, "kMRMediaRemoteNowPlayingInfoPlaybackRate")
    let isPlaying = systemPlaybackState.map { $0 == 1 } ?? playbackRate.map { $0 != 0 } ?? true

    let result: [String: Any] = [
        "title": title,
        "artist": artist,
        "album": album,
        "duration": duration * 1000,
        "position": currentPosition(elapsed: elapsed, info: dict, isPlaying: isPlaying) * 1000,
        "isPlaying": isPlaying
    ]

    printJSON(result)
    exit(0)
}

private func loadSymbol<T>(_ name: String, as type: T.Type) -> T? {
    guard let symbol = dlsym(mediaRemote, name) else {
        return nil
    }
    return unsafeBitCast(symbol, to: type)
}

private func stringValue(_ dict: NSDictionary, _ key: String) -> String {
    if let value = dict[key] as? String {
        return value.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    return ""
}

private func doubleValue(_ dict: NSDictionary, _ key: String) -> Double {
    return optionalDoubleValue(dict, key) ?? 0
}

private func optionalDoubleValue(_ dict: NSDictionary, _ key: String) -> Double? {
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

private func dateValue(_ dict: NSDictionary, _ key: String) -> Date? {
    return dict[key] as? Date
}

private func currentPosition(elapsed: Double, info: NSDictionary, isPlaying: Bool) -> Double {
    guard isPlaying, let timestamp = dateValue(info, "kMRMediaRemoteNowPlayingInfoTimestamp") else {
        return elapsed
    }
    return max(0, elapsed + Date().timeIntervalSince(timestamp))
}

private func printJSON(_ dict: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: dict, options: []),
       let str = String(data: data, encoding: .utf8) {
        print(str)
    }
}
