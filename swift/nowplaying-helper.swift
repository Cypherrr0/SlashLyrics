import Darwin
import Foundation

private let mediaRemotePath = "/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote"
private let updateQueue = DispatchQueue(label: "slashlyrics.mediaremote.update")
private let finishLock = NSLock()
private let debugMode = CommandLine.arguments.contains("--debug")

private var didFinish = false
private var latestInfo: NSDictionary?
private var systemPlaybackState: Int?
private var nowPlayingApplicationPID: Int32?
private var nowPlayingClientInfo: [String: Any] = [:]

typealias MRMediaRemoteGetNowPlayingInfoFunc = @convention(c)
    (DispatchQueue, @escaping (CFDictionary?) -> Void) -> Void
typealias MRMediaRemoteGetNowPlayingApplicationIsPlayingFunc = @convention(c)
    (DispatchQueue, @escaping (Bool) -> Void) -> Void
typealias MRMediaRemoteGetNowPlayingApplicationPIDFunc = @convention(c)
    (DispatchQueue, @escaping (Int32) -> Void) -> Void
typealias MRMediaRemoteGetNowPlayingClientFunc = @convention(c)
    (DispatchQueue, @escaping (AnyObject?) -> Void) -> Void
typealias MRNowPlayingClientGetStringFunc = @convention(c)
    (AnyObject?) -> NSString?
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
let getNowPlayingApplicationPID = loadSymbol(
    "MRMediaRemoteGetNowPlayingApplicationPID",
    as: MRMediaRemoteGetNowPlayingApplicationPIDFunc.self
)
let getNowPlayingClient = loadSymbol(
    "MRMediaRemoteGetNowPlayingClient",
    as: MRMediaRemoteGetNowPlayingClientFunc.self
)
let getClientBundleIdentifier = loadSymbol(
    "MRNowPlayingClientGetBundleIdentifier",
    as: MRNowPlayingClientGetStringFunc.self
)
let getClientParentBundleIdentifier = loadSymbol(
    "MRNowPlayingClientGetParentAppBundleIdentifier",
    as: MRNowPlayingClientGetStringFunc.self
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
let isPlayingObserver = notificationCenter.addObserver(
    forName: Notification.Name("kMRMediaRemoteNowPlayingApplicationIsPlayingDidChangeNotification"),
    object: nil,
    queue: nil
) { notification in
    if let isPlaying = notification.userInfo?["kMRMediaRemoteNowPlayingApplicationIsPlayingUserInfoKey"] as? Bool {
        systemPlaybackState = isPlaying ? 1 : 2
    }
    requestNowPlayingInfo()
}

getNowPlayingApplicationIsPlaying?(updateQueue) { isPlaying in
    systemPlaybackState = isPlaying ? 1 : 2
    requestNowPlayingInfo()
}

requestNowPlayingInfo()
requestNowPlayingClient()
requestNowPlayingApplicationPID()
for delay in [0.15, 0.5, 1.0] {
    DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
        requestNowPlayingInfo()
        requestNowPlayingClient()
        requestNowPlayingApplicationPID()
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

private func requestNowPlayingApplicationPID() {
    getNowPlayingApplicationPID?(updateQueue) { pid in
        nowPlayingApplicationPID = pid
    }
}

private func requestNowPlayingClient() {
    getNowPlayingClient?(updateQueue) { client in
        guard let client else {
            nowPlayingClientInfo = ["present": false]
            return
        }

        nowPlayingClientInfo = [
            "present": true,
            "bundleIdentifier": clientString(client, getClientBundleIdentifier) ?? NSNull(),
            "parentBundleIdentifier": clientString(client, getClientParentBundleIdentifier) ?? NSNull(),
            "displayName": performStringSelector(client, "displayName") ?? NSNull(),
            "className": String(describing: type(of: client))
        ]
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
    notificationCenter.removeObserver(isPlayingObserver)
    unregisterForNowPlayingNotifications?()
    dlclose(mediaRemote)

    guard let dict else {
        printJSON(notPlayingResult(reason: "no now playing info"))
        exit(0)
    }

    let title = stringValue(dict, "kMRMediaRemoteNowPlayingInfoTitle")
    guard !title.isEmpty else {
        printJSON(notPlayingResult(reason: "missing title", info: dict))
        exit(0)
    }

    let artist = stringValue(dict, "kMRMediaRemoteNowPlayingInfoArtist")
    let album = stringValue(dict, "kMRMediaRemoteNowPlayingInfoAlbum")
    let duration = doubleValue(dict, "kMRMediaRemoteNowPlayingInfoDuration")
    let elapsed = doubleValue(dict, "kMRMediaRemoteNowPlayingInfoElapsedTime")
    let playbackRate = optionalDoubleValue(dict, "kMRMediaRemoteNowPlayingInfoPlaybackRate")
    let isPlaying = systemPlaybackState.map { $0 == 1 } ?? playbackRate.map { $0 != 0 } ?? true

    var result: [String: Any] = [
        "title": title,
        "artist": artist,
        "album": album,
        "duration": duration * 1000,
        "position": currentPosition(elapsed: elapsed, info: dict, isPlaying: isPlaying) * 1000,
        "isPlaying": isPlaying
    ]
    if debugMode {
        result["debug"] = debugInfo(reason: "ok", info: dict)
    }

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

private func notPlayingResult(reason: String, info: NSDictionary? = nil) -> [String: Any] {
    var result: [String: Any] = [
        "isPlaying": false,
        "reason": reason
    ]
    if debugMode {
        result["debug"] = debugInfo(reason: reason, info: info)
    }
    return result
}

private func debugInfo(reason: String, info: NSDictionary?) -> [String: Any] {
    let playbackStateValue: Any = systemPlaybackState.map { NSNumber(value: $0) } ?? NSNull()
    var debug: [String: Any] = [
        "reason": reason,
        "mediaRemotePath": mediaRemotePath,
        "hasGetNowPlayingInfo": true,
        "hasGetNowPlayingApplicationIsPlaying": getNowPlayingApplicationIsPlaying != nil,
        "hasGetNowPlayingApplicationPID": getNowPlayingApplicationPID != nil,
        "hasGetNowPlayingClient": getNowPlayingClient != nil,
        "hasClientBundleIdentifier": getClientBundleIdentifier != nil,
        "hasClientParentBundleIdentifier": getClientParentBundleIdentifier != nil,
        "hasRegisterForNowPlayingNotifications": registerForNowPlayingNotifications != nil,
        "hasUnregisterForNowPlayingNotifications": unregisterForNowPlayingNotifications != nil,
        "systemPlaybackState": playbackStateValue,
        "nowPlayingApplicationPID": nowPlayingApplicationPID.map { NSNumber(value: $0) } ?? NSNull(),
        "nowPlayingClient": nowPlayingClientInfo,
        "arguments": CommandLine.arguments
    ]

    guard let info else {
        debug["rawKeyCount"] = 0
        debug["raw"] = [:]
        return debug
    }

    let keys = info.allKeys.compactMap { $0 as? String }.sorted()
    var raw: [String: Any] = [:]
    for key in keys {
        raw[key] = jsonSafeValue(info[key])
    }
    debug["rawKeyCount"] = keys.count
    debug["rawKeys"] = keys
    debug["raw"] = raw
    return debug
}

private func clientString(_ client: AnyObject, _ getter: MRNowPlayingClientGetStringFunc?) -> Any? {
    guard let value = getter?(client) else {
        return nil
    }
    return value as String
}

private func performStringSelector(_ object: AnyObject, _ selectorName: String) -> Any? {
    let selector = NSSelectorFromString(selectorName)
    guard object.responds(to: selector),
          let unmanaged = object.perform(selector),
          let value = unmanaged.takeUnretainedValue() as? NSString else {
        return nil
    }
    return value as String
}

private func jsonSafeValue(_ value: Any?) -> Any {
    switch value {
    case let value as String:
        return value
    case let value as NSNumber:
        return value
    case let value as Date:
        return value.timeIntervalSince1970
    case let value as Data:
        return "<data \(value.count) bytes>"
    case let value as NSArray:
        return value.map { jsonSafeValue($0) }
    case let value as NSDictionary:
        var dict: [String: Any] = [:]
        for (key, val) in value {
            dict[String(describing: key)] = jsonSafeValue(val)
        }
        return dict
    case .some(let value):
        return String(describing: value)
    case .none:
        return NSNull()
    }
}

private func printJSON(_ dict: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: dict, options: []),
       let str = String(data: data, encoding: .utf8) {
        print(str)
    }
}
