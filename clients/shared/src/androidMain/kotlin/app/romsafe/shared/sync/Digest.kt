package app.romsafe.shared.sync

import java.security.MessageDigest

actual fun sha256Hex(bytes: ByteArray): String = digest("SHA-256", bytes)

actual fun sha1Hex(bytes: ByteArray): String = digest("SHA-1", bytes)

private fun digest(algorithm: String, bytes: ByteArray): String =
    MessageDigest.getInstance(algorithm).digest(bytes).joinToString("") { "%02x".format(it) }
