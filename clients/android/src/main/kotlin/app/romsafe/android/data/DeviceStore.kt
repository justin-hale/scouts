package app.romsafe.android.data

import android.content.Context
import androidx.core.content.edit
import app.romsafe.shared.api.GameSort
import app.romsafe.shared.api.PlatformSort
import app.romsafe.shared.api.RomSafeApi
import app.romsafe.shared.library.LibraryPrefs
import app.romsafe.shared.setup.EmulatorSetup
import app.romsafe.shared.setup.PlatformSetup
import app.romsafe.shared.sync.SyncReport
import kotlinx.serialization.Serializable

data class Pairing(val serverUrl: String, val deviceId: Long, val deviceName: String, val token: String)

/** The single-emulator format the first build stored; read once and converted. */
@Serializable
private data class LegacyMapping(val profile: String, val saveUri: String? = null, val romUri: String? = null)

/**
 * Small key-value state that has to survive restarts: the pairing and the
 * folder setup. Folder locations in [PlatformSetup] are SAF tree URIs we hold
 * a persisted grant for.
 */
class DeviceStore(context: Context) : LibraryPrefs {
    private val prefs = context.getSharedPreferences("romsafe", Context.MODE_PRIVATE)
    private val json = RomSafeApi.json

    /** Prefills the pair screen, so re-pairing doesn't mean retyping the address. */
    var lastServerUrl: String?
        get() = prefs.getString(KEY_LAST_URL, null)
        set(value) = prefs.edit { putString(KEY_LAST_URL, value) }

    /** The library's sort choices; they outlive re-pairing like other view settings. */
    override var librarySort: GameSort
        get() = GameSort.fromWire(prefs.getString(KEY_LIBRARY_SORT, null))
        set(value) = prefs.edit { putString(KEY_LIBRARY_SORT, value.wire) }

    override var libraryPlatformSort: PlatformSort
        get() = PlatformSort.fromWire(prefs.getString(KEY_LIBRARY_PLATFORM_SORT, null))
        set(value) = prefs.edit { putString(KEY_LIBRARY_PLATFORM_SORT, value.wire) }

    fun pairing(): Pairing? {
        val url = prefs.getString(KEY_URL, null) ?: return null
        val token = prefs.getString(KEY_TOKEN, null)?.let(TokenCipher::decrypt) ?: return null
        return Pairing(url, prefs.getLong(KEY_DEVICE_ID, 0), prefs.getString(KEY_DEVICE_NAME, null).orEmpty(), token)
    }

    fun savePairing(p: Pairing) = prefs.edit {
        putString(KEY_URL, p.serverUrl)
        putLong(KEY_DEVICE_ID, p.deviceId)
        putString(KEY_DEVICE_NAME, p.deviceName)
        putString(KEY_TOKEN, TokenCipher.encrypt(p.token))
        putString(KEY_LAST_URL, p.serverUrl)
    }

    fun clearPairing() = prefs.edit {
        remove(KEY_URL)
        remove(KEY_DEVICE_ID)
        remove(KEY_DEVICE_NAME)
        remove(KEY_TOKEN)
        remove(KEY_SETUPS)
        remove(KEY_LEGACY_MAPPINGS)
        remove(KEY_SYNC_REPORT)
    }

    fun lastSyncReport(): SyncReport? =
        prefs.getString(KEY_SYNC_REPORT, null)?.let { runCatching { json.decodeFromString<SyncReport>(it) }.getOrNull() }

    fun saveSyncReport(report: SyncReport) = prefs.edit { putString(KEY_SYNC_REPORT, json.encodeToString(report)) }

    fun setups(): Map<String, PlatformSetup> {
        prefs.getString(KEY_SETUPS, null)?.let { stored ->
            return runCatching { json.decodeFromString<Map<String, PlatformSetup>>(stored) }.getOrNull().orEmpty()
        }
        val legacy = prefs.getString(KEY_LEGACY_MAPPINGS, null)
            ?.let { runCatching { json.decodeFromString<Map<String, LegacyMapping>>(it) }.getOrNull() }
            .orEmpty()
        return legacy.mapValues { (_, m) -> PlatformSetup(m.romUri, listOf(EmulatorSetup("", m.profile, m.saveUri))) }
    }

    fun saveSetups(setups: Map<String, PlatformSetup>) = prefs.edit {
        putString(KEY_SETUPS, json.encodeToString(setups))
        remove(KEY_LEGACY_MAPPINGS)
    }

    private companion object {
        const val KEY_URL = "server_url"
        const val KEY_LAST_URL = "last_server_url"
        const val KEY_DEVICE_ID = "device_id"
        const val KEY_DEVICE_NAME = "device_name"
        const val KEY_TOKEN = "device_token"
        const val KEY_SETUPS = "platform_setups"
        const val KEY_LEGACY_MAPPINGS = "mappings"
        const val KEY_SYNC_REPORT = "last_sync_report"
        const val KEY_LIBRARY_SORT = "library_sort"
        const val KEY_LIBRARY_PLATFORM_SORT = "library_platform_sort"
    }
}
