package app.romsafe.shared

import kotlin.math.roundToLong

/** Short file sizes like Android's Formatter.formatShortFileSize: "820 kB", "1.4 GB" (1000-based). */
fun formatSize(bytes: Long): String {
    if (bytes < 1000) return "$bytes B"
    val units = listOf("kB", "MB", "GB", "TB")
    var value = bytes / 1000.0
    var unit = 0
    while (value >= 1000 && unit < units.lastIndex) {
        value /= 1000
        unit++
    }
    // One decimal below 10 ("1.4 GB"), none above ("820 MB"), as Android does.
    val text = if (value < 10) {
        val tenths = (value * 10).roundToLong()
        if (tenths % 10 == 0L) "${tenths / 10}" else "${tenths / 10}.${tenths % 10}"
    } else {
        "${value.roundToLong()}"
    }
    return "$text ${units[unit]}"
}
