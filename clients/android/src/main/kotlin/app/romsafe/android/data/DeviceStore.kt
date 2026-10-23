package app.romsafe.android.data

import android.content.Context
import androidx.core.content.edit
import app.romsafe.shared.api.RomSafeApi
import kotlinx.serialization.Serializable

data class Pairing(val serverUrl: String, val deviceId: Long, val deviceName: String, val token: String)

/** What this device uses for one platform. Folder URIs are SAF tree URIs we hold a persisted grant for. */
@Serializable
data class LocalMapping(val profile: String, val saveUri: String? = null, val romUri: String? = null)

/** Small key-value state that has to survive restarts: the pairing and the folder mappings. */
class DeviceStore(context: Context) {
    private val prefs = context.getSharedPreferences("romsafe", Context.MODE_PRIVATE)
    private val json = RomSafeApi.json

    /** Prefills the pair screen, so re-pairing doesn't mean retyping the address. */
    var lastServerUrl: String?
        get() = prefs.getString(KEY_LAST_URL, null)
        set(value) = prefs.edit { putString(KEY_LAST_URL, value) }

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
        remove(KEY_MAPPINGS)
    }

    fun mappings(): Map<String, LocalMapping> =
        prefs.getString(KEY_MAPPINGS, null)
            ?.let { runCatching { json.decodeFromString<Map<String, LocalMapping>>(it) }.getOrNull() }
            .orEmpty()

    fun saveMappings(mappings: Map<String, LocalMapping>) = prefs.edit {
        putString(KEY_MAPPINGS, json.encodeToString(mappings))
    }

    private companion object {
        const val KEY_URL = "server_url"
        const val KEY_LAST_URL = "last_server_url"
        const val KEY_DEVICE_ID = "device_id"
        const val KEY_DEVICE_NAME = "device_name"
        const val KEY_TOKEN = "device_token"
        const val KEY_MAPPINGS = "mappings"
    }
}
