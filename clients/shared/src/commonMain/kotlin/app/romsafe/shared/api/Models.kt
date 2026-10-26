package app.romsafe.shared.api

import kotlinx.serialization.Serializable

// Wire types for the device API. docs/sync-protocol.md is the source of truth;
// field names match the server's JSON exactly.

@Serializable
data class PairRequest(val code: String, val name: String, val kind: String)

@Serializable
data class PairResponse(val deviceId: Long, val token: String)

@Serializable
data class DeviceInfo(val id: Long, val name: String, val kind: String)

@Serializable
data class PlatformInfo(
    val slug: String,
    val name: String,
    /** `rom`, `titleId`, `saveDir` or `card`: how the server keys this platform's saves. */
    val keyKind: String,
    val romExtensions: List<String> = emptyList(),
    /** Ids of the profiles that support this platform. */
    val profiles: List<String> = emptyList(),
)

@Serializable
data class DefaultPaths(val android: List<String> = emptyList(), val windows: List<String> = emptyList())

@Serializable
data class SaveRule(
    val platforms: List<String>,
    val pattern: String,
    val file: String? = null,
    val defaults: Map<String, String> = emptyMap(),
    val format: String? = null,
)

@Serializable
data class Profile(
    val id: String,
    val name: String,
    val description: String? = null,
    val defaultPaths: DefaultPaths? = null,
    val saves: List<SaveRule> = emptyList(),
)

@Serializable
data class Mapping(
    val platform: String,
    val profile: String,
    /** Which of this device's emulators for the platform; "" is the first. Each slot syncs separately. */
    val slot: String = "",
    /** Informational only: shown in the web GUI. The device keeps its own folder handles. */
    val saveRoot: String? = null,
    val romRoot: String? = null,
)

@Serializable
data class DeviceConfig(
    val device: DeviceInfo,
    val platforms: List<PlatformInfo>,
    val profiles: List<Profile>,
    val mappings: List<Mapping>,
)

@Serializable
data class MappingsRequest(val mappings: List<Mapping>)

// --- ROMs ---------------------------------------------------------------------

@Serializable
data class InventoryFile(val path: String, val size: Long, val sha1: String? = null)

@Serializable
data class InventoryRequest(val platform: String, val complete: Boolean, val files: List<InventoryFile>)

@Serializable
data class InventoryResult(val path: String, val romId: Long? = null, val match: String)

@Serializable
data class InventoryResponse(val results: List<InventoryResult>)

@Serializable
data class ServerRom(
    val id: Long,
    val relPath: String,
    val fileName: String,
    val size: Long,
    val sha1: String? = null,
    val gameTitle: String? = null,
    val cover: String? = null,
    /** Where this device has the ROM, or null when it doesn't. */
    val localPath: String? = null,
)

@Serializable
data class QueuedRom(
    val id: Long,
    val platform: String,
    val relPath: String,
    val fileName: String,
    val size: Long,
    val sha1: String? = null,
    /** The ROM plus its companion files, for sets that download as one zip. */
    val totalSize: Long? = null,
    /** Downloads as a zip of the ROM and its companion files (.cue + .bin tracks, .m3u + discs). */
    val multiFile: Boolean = false,
    val url: String,
)

/** A game in the server library with its ROMs, from GET /api/device/library (or /games). */
@Serializable
data class LibraryGame(
    val id: Long,
    val title: String,
    val platform: String = "",
    val releaseDate: String? = null,
    /** File name under /api/covers/, cached by the server. */
    val cover: String? = null,
    /** When the game joined the library (ms). */
    val addedAt: Long? = null,
    /** Saves with a current version. */
    val saveCount: Int = 0,
    val roms: List<LibraryRom> = emptyList(),
)

/** A platform with games, for the library's headings and filter chips. */
@Serializable
data class LibraryPlatform(val slug: String, val name: String, val games: Int)

/** GET /api/device/library: games grouped by platform, in [platforms] order. */
@Serializable
data class Library(val platforms: List<LibraryPlatform>, val games: List<LibraryGame>)

/** Game order inside each platform group. The server sorts; [wire] is the `sort` query value. */
enum class GameSort(val wire: String, val label: String) {
    TITLE("title", "Title A–Z"),
    TITLE_DESC("title-desc", "Title Z–A"),
    ADDED("added", "Recently added"),
    RELEASED("released", "Release date"),
    SAVED("saved", "Recently saved"),
    ;

    companion object {
        fun fromWire(value: String?) = entries.find { it.wire == value } ?: TITLE
    }
}

/** Order of the platform groups; [wire] is the `platformSort` query value. */
enum class PlatformSort(val wire: String, val label: String) {
    NAME("name", "Platforms A–Z"),
    GAMES("games", "Most games first"),
    ;

    companion object {
        fun fromWire(value: String?) = entries.find { it.wire == value } ?: NAME
    }
}

// --- game pages (GET /api/games/{id}) -------------------------------------------

@Serializable
data class GameDetail(
    val id: Long,
    val platform: String,
    val title: String,
    val titleId: String? = null,
    val summary: String? = null,
    val releaseDate: String? = null,
    val cover: String? = null,
    /** Where the metadata came from (`igdb`, `steamgriddb`, ...), or null when it's only the file name. */
    val metadataSource: String? = null,
    val roms: List<GameRom> = emptyList(),
    val saves: List<GameSave> = emptyList(),
    val extras: List<GameExtra> = emptyList(),
)

@Serializable
data class GameRom(
    val id: Long,
    val relPath: String,
    val fileName: String,
    val size: Long,
    /** Size including [parts]. */
    val totalSize: Long = size,
    val crc32: String? = null,
    val sha1: String? = null,
    val titleId: String? = null,
    val missing: Boolean = false,
    /** Files that go with this ROM (a .cue's tracks, an .m3u's discs); it downloads as one zip. */
    val parts: List<RomPart> = emptyList(),
    val serverPath: String? = null,
    /** Where this device has it, or null. */
    val localPath: String? = null,
    val queued: Boolean = false,
)

@Serializable
data class RomPart(val path: String, val size: Long, val serverPath: String? = null)

@Serializable
data class GameExtra(
    val id: Long,
    /** `dlc`, `mod`, `hack`, `patch`, `firmware`, ... */
    val kind: String,
    val relPath: String,
    val fileName: String,
    val size: Long,
    val missing: Boolean = false,
    val serverPath: String? = null,
)

@Serializable
data class GameSave(
    val id: Long,
    val gameKey: String,
    val file: String,
    val currentVersionId: Long? = null,
    val sha256: String? = null,
    val size: Long? = null,
    val updatedAt: Long? = null,
    /** Device that made the current version; null for the server (scan or web upload). */
    val updatedBy: String? = null,
    val versionCount: Int = 0,
    /** What the file is called when downloaded. */
    val downloadName: String,
    /** The current version holds no game data (never written, or an empty memory card). */
    val empty: Boolean = false,
    val serverPath: String? = null,
)

@Serializable
data class SaveVersion(
    val id: Long,
    val sha256: String,
    val size: Long,
    val createdAt: Long,
    val note: String? = null,
    /** Device that uploaded it; null for the server. */
    val device: String? = null,
    val isCurrent: Boolean = false,
)

@Serializable
data class LibraryRom(
    val id: Long,
    val fileName: String,
    val relPath: String,
    /** Download size: the whole set for multi-file ROMs. */
    val size: Long,
    val multiFile: Boolean = false,
    /** Where this device has it, or null. */
    val localPath: String? = null,
    val queued: Boolean = false,
)

@Serializable
data class QueueRequest(val romIds: List<Long>)

// --- saves --------------------------------------------------------------------

@Serializable
data class LocalSave(val path: String, val sha256: String, val size: Long)

@Serializable
data class PlanRequest(val platform: String, val files: List<LocalSave>, val slot: String = "")

/**
 * One step of a save plan. Kept flat rather than sealed so a client keeps working
 * if the server adds an action it doesn't know yet (it is skipped).
 */
@Serializable
data class SyncAction(
    val action: String,
    val path: String,
    val saveId: Long? = null,
    val versionId: Long? = null,
    val sha256: String? = null,
    val size: Long? = null,
    val baseVersionId: Long? = null,
    val serverVersionId: Long? = null,
    val conflictId: Long? = null,
) {
    companion object {
        const val OK = "ok"
        const val UPLOAD = "upload"
        const val DOWNLOAD = "download"
        const val CONFLICT = "conflict"
        const val PENDING_CONFLICT = "pending-conflict"
        const val UNRECOGNIZED = "unrecognized"
        const val EMPTY = "empty"
        const val DELETED = "deleted"
    }
}

@Serializable
data class PlanResponse(val actions: List<SyncAction>)

@Serializable
data class UploadResponse(
    /** `ok`, `conflict`, `empty` (kept in history only) or `deleted` (deleted in the GUI; nothing stored). */
    val status: String,
    val saveId: Long? = null,
    val versionId: Long? = null,
    val conflictId: Long? = null,
)

@Serializable
data class AckRequest(val saveId: Long, val versionId: Long, val slot: String = "")

@Serializable
internal data class ErrorBody(val error: String? = null)
