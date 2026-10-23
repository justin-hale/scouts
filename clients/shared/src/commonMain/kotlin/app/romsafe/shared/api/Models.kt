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
    val url: String,
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
    }
}

@Serializable
data class PlanResponse(val actions: List<SyncAction>)

@Serializable
data class UploadResponse(
    /** `ok` or `conflict`. */
    val status: String,
    val saveId: Long,
    val versionId: Long,
    val conflictId: Long? = null,
)

@Serializable
data class AckRequest(val saveId: Long, val versionId: Long, val slot: String = "")

@Serializable
internal data class ErrorBody(val error: String? = null)
