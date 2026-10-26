package app.romsafe.desktop.data

import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import kotlin.io.path.isDirectory
import kotlin.io.path.name

/** Where the app keeps its settings and hash cache. */
object AppDirs {
    private val os = System.getProperty("os.name").lowercase()

    val data: Path by lazy {
        val home = Paths.get(System.getProperty("user.home"))
        when {
            // Local, not roaming: the hash cache and folder paths belong to this machine.
            os.startsWith("windows") -> Paths.get(System.getenv("LOCALAPPDATA") ?: home.resolve("AppData/Local").toString(), "RomSafe")
            os.contains("mac") -> home.resolve("Library/Application Support/RomSafe")
            else -> Paths.get(System.getenv("XDG_CONFIG_HOME") ?: home.resolve(".config").toString(), "romsafe")
        }
    }
}

/** Plain filesystem folders, the desktop's answer to Android's SAF grants. */
object Folders {
    private val variable = Regex("""%([A-Za-z0-9_()]+)%""")

    /** Expands a profile hint like `%APPDATA%\Dolphin Emulator` or `~/.config/...`; null when a variable is unknown. */
    fun expand(hint: String): Path? {
        var unknown = false
        var text = variable.replace(hint) { m ->
            System.getenv(m.groupValues[1]) ?: run {
                unknown = true
                ""
            }
        }
        if (unknown) return null
        if (text.startsWith("~")) text = System.getProperty("user.home") + text.substring(1)
        return runCatching { Paths.get(text) }.getOrNull()
    }

    /** The profile's usual folders that exist on this machine, in the profile's order. */
    fun existingDefaults(hints: List<String>): List<Path> = hints.mapNotNull(::expand).filter { it.isDirectory() }

    fun usable(location: String): Boolean = runCatching { Paths.get(location).isDirectory() }.getOrDefault(false)

    /** A shorter label for a path: `%APPDATA%\Dolphin Emulator` rather than the full user folder. */
    fun label(location: String): String {
        val home = System.getProperty("user.home")
        val appData = System.getenv("APPDATA")
        return when {
            appData != null && location.startsWith(appData, ignoreCase = true) -> "%APPDATA%" + location.substring(appData.length)
            location.startsWith(home, ignoreCase = true) -> "~" + location.substring(home.length)
            else -> location
        }
    }

    /**
     * Checks that [location] directly contains one of [topFolders] (e.g. "GC"),
     * which catches a folder picked one level off. Returns what's wrong, or null.
     */
    fun layoutProblem(location: String, topFolders: Set<String>): String? {
        val dir = runCatching { Paths.get(location) }.getOrNull() ?: return "That isn't a valid folder path."
        if (!dir.isDirectory()) return "This folder doesn't exist any more. Choose it again."
        if (topFolders.isEmpty()) return null
        val expected = topFolders.map { it.lowercase() }
        val names = runCatching { Files.list(dir).use { s -> s.map { it.name.lowercase() }.toList() } }.getOrNull() ?: return null
        if (names.any { it in expected }) return null
        val wanted = topFolders.joinToString(" or ") { "\"$it\"" }
        return if (dir.name.lowercase() in expected) {
            "This is the $wanted folder itself. Pick the folder that contains it."
        } else {
            "There's no $wanted folder in here. Pick the folder that contains it."
        }
    }
}
