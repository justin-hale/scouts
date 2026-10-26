package app.romsafe.desktop.data

import com.sun.jna.platform.win32.Crypt32Util
import java.util.Base64

/**
 * Keeps the device token out of plain sight in settings.json. On Windows it
 * is sealed with DPAPI (only this Windows user can open it); elsewhere the
 * file sits in the user's own config folder and the token is stored as is.
 */
object TokenCipher {
    private const val DPAPI = "dpapi:"
    private const val PLAIN = "plain:"
    private val windows = System.getProperty("os.name").startsWith("Windows", ignoreCase = true)

    fun encrypt(token: String): String =
        if (windows) {
            DPAPI + Base64.getEncoder().encodeToString(Crypt32Util.cryptProtectData(token.toByteArray()))
        } else {
            PLAIN + token
        }

    /** Null when it can't be opened (e.g. settings copied from another user), which means pairing again. */
    fun decrypt(stored: String): String? = runCatching {
        when {
            stored.startsWith(DPAPI) -> String(Crypt32Util.cryptUnprotectData(Base64.getDecoder().decode(stored.removePrefix(DPAPI))))
            stored.startsWith(PLAIN) -> stored.removePrefix(PLAIN)
            else -> null
        }
    }.getOrNull()
}
