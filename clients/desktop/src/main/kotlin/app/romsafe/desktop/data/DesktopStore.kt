package app.romsafe.desktop.data

import app.romsafe.shared.api.GameSort
import app.romsafe.shared.api.PlatformSort
import app.romsafe.shared.api.RomSafeApi
import app.romsafe.shared.library.LibraryPrefs
import app.romsafe.shared.setup.PlatformSetup
import app.romsafe.shared.sync.SyncReport
import kotlinx.serialization.Serializable
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption

data class Pairing(val serverUrl: String, val deviceId: Long, val deviceName: String, val token: String)

/** Everything the app keeps between runs, in one JSON file. */
@Serializable
private data class Settings(
    val serverUrl: String? = null,
    val deviceId: Long = 0,
    val deviceName: String? = null,
    /** Encrypted with [TokenCipher] where the OS offers it. */
    val token: String? = null,
    val lastServerUrl: String? = null,
    /** Folder locations are absolute paths. */
    val setups: Map<String, PlatformSetup> = emptyMap(),
    val lastSyncReport: SyncReport? = null,
    val librarySort: String? = null,
    val libraryPlatformSort: String? = null,
    /** The "still running in the tray" hint shows once. */
    val trayHintShown: Boolean = false,
)

/**
 * The desktop counterpart of Android's DeviceStore: pairing, folder setup and
 * view settings in `settings.json` under [AppDirs.data]. Writes go through a
 * temp file so a crash can't leave half a settings file.
 */
class DesktopStore(private val dir: Path = AppDirs.data) : LibraryPrefs {
    private val file = dir.resolve("settings.json")
    private val json = RomSafeApi.json
    private var settings: Settings = load()

    @Synchronized
    private fun load(): Settings = runCatching { json.decodeFromString<Settings>(Files.readString(file)) }.getOrDefault(Settings())

    @Synchronized
    private fun edit(change: (Settings) -> Settings) {
        settings = change(settings)
        Files.createDirectories(dir)
        val temp = dir.resolve("settings.json.tmp")
        Files.writeString(temp, json.encodeToString(settings))
        Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
    }

    /** Prefills the pair screen, so re-pairing doesn't mean retyping the address. */
    val lastServerUrl: String? get() = settings.lastServerUrl

    override var librarySort: GameSort
        get() = GameSort.fromWire(settings.librarySort)
        set(value) = edit { it.copy(librarySort = value.wire) }

    override var libraryPlatformSort: PlatformSort
        get() = PlatformSort.fromWire(settings.libraryPlatformSort)
        set(value) = edit { it.copy(libraryPlatformSort = value.wire) }

    var trayHintShown: Boolean
        get() = settings.trayHintShown
        set(value) = edit { it.copy(trayHintShown = value) }

    fun pairing(): Pairing? {
        val s = settings
        val url = s.serverUrl ?: return null
        val token = s.token?.let(TokenCipher::decrypt) ?: return null
        return Pairing(url, s.deviceId, s.deviceName.orEmpty(), token)
    }

    fun savePairing(p: Pairing) = edit {
        it.copy(
            serverUrl = p.serverUrl,
            deviceId = p.deviceId,
            deviceName = p.deviceName,
            token = TokenCipher.encrypt(p.token),
            lastServerUrl = p.serverUrl,
        )
    }

    fun clearPairing() = edit {
        it.copy(serverUrl = null, deviceId = 0, deviceName = null, token = null, setups = emptyMap(), lastSyncReport = null)
    }

    fun lastSyncReport(): SyncReport? = settings.lastSyncReport

    fun saveSyncReport(report: SyncReport) = edit { it.copy(lastSyncReport = report) }

    fun setups(): Map<String, PlatformSetup> = settings.setups

    fun saveSetups(setups: Map<String, PlatformSetup>) = edit { it.copy(setups = setups) }
}
