package app.romsafe.desktop.sync

import java.io.IOException
import java.nio.file.ClosedWatchServiceException
import java.nio.file.FileSystems
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardWatchEventKinds.ENTRY_CREATE
import java.nio.file.StandardWatchEventKinds.ENTRY_DELETE
import java.nio.file.StandardWatchEventKinds.ENTRY_MODIFY
import java.nio.file.StandardWatchEventKinds.OVERFLOW
import java.nio.file.WatchKey
import java.nio.file.WatchService
import kotlin.io.path.isDirectory
import kotlin.io.path.name

/** A save folder to watch, and which of its subfolders can hold saves (relative, `/`-separated). */
class WatchRoot(val path: Path, val descend: (String) -> Boolean)

/**
 * Watches save folders with the OS file watcher and calls [onChange] when a
 * file in them changes, so a sync can follow soon after an emulator writes.
 * Only folders a profile could keep saves in are watched: a 3DS sdmc folder
 * holds thousands of folders of installed games.
 */
class FolderWatcher(roots: List<WatchRoot>, private val onChange: (Path) -> Unit) : AutoCloseable {
    private val service: WatchService = FileSystems.getDefault().newWatchService()
    private val keys = HashMap<WatchKey, Pair<WatchRoot, String>>()
    private val thread = Thread(::loop, "romsafe-folder-watcher").apply { isDaemon = true }

    init {
        roots.forEach { register(it, "") }
        thread.start()
    }

    val watchedFolders: Int get() = synchronized(keys) { keys.size }

    private fun register(root: WatchRoot, rel: String) {
        val dir = if (rel.isEmpty()) root.path else root.path.resolve(rel)
        if (!dir.isDirectory()) return
        try {
            val key = dir.register(service, ENTRY_CREATE, ENTRY_MODIFY, ENTRY_DELETE)
            synchronized(keys) { keys[key] = root to rel }
            Files.newDirectoryStream(dir) { it.isDirectory() }.use { children ->
                for (child in children) {
                    val childRel = if (rel.isEmpty()) child.name else "$rel/${child.name}"
                    if (root.descend(childRel)) register(root, childRel)
                }
            }
        } catch (e: IOException) {
            // A folder that vanished or can't be read is simply not watched.
        } catch (e: ClosedWatchServiceException) {
            return
        }
    }

    private fun loop() {
        while (true) {
            val key = try {
                service.take()
            } catch (e: ClosedWatchServiceException) {
                return
            } catch (e: InterruptedException) {
                return
            }
            val (root, rel) = synchronized(keys) { keys[key] } ?: run {
                key.cancel()
                continue
            }
            val dir = if (rel.isEmpty()) root.path else root.path.resolve(rel)
            for (event in key.pollEvents()) {
                if (event.kind() == OVERFLOW) {
                    onChange(dir)
                    continue
                }
                val name = (event.context() as? Path)?.name ?: continue
                // Our own temp and part files come and go during every sync and download.
                if (name.endsWith(".romsafe-tmp") || name.endsWith(".romsafe-part")) continue
                val childRel = if (rel.isEmpty()) name else "$rel/$name"
                val child = dir.resolve(name)
                if (event.kind() == ENTRY_CREATE && child.isDirectory() && root.descend(childRel)) register(root, childRel)
                onChange(child)
            }
            if (!key.reset()) synchronized(keys) { keys.remove(key) }
        }
    }

    override fun close() {
        runCatching { service.close() }
        thread.interrupt()
    }
}
