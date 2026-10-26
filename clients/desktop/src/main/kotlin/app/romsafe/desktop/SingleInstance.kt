package app.romsafe.desktop

import app.romsafe.desktop.data.AppDirs
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.channels.FileChannel
import java.nio.channels.FileLock
import java.nio.file.Files
import java.nio.file.StandardOpenOption

/**
 * One RomSafe per user: two would sync the same folders at once. The first
 * instance holds a file lock and listens on a loopback port (written next to
 * the lock); later launches poke that port so the first shows its window.
 */
class SingleInstance private constructor(private val lock: FileLock, private val server: ServerSocket) : AutoCloseable {
    override fun close() {
        runCatching { server.close() }
        runCatching { lock.release() }
        runCatching { lock.channel().close() }
    }

    companion object {
        private val dir = AppDirs.data
        private val lockFile = dir.resolve("instance.lock")
        private val portFile = dir.resolve("instance.port")

        /** Null when another instance already runs (it has been asked to show itself). */
        fun acquire(onShow: () -> Unit): SingleInstance? {
            Files.createDirectories(dir)
            val channel = FileChannel.open(lockFile, StandardOpenOption.CREATE, StandardOpenOption.WRITE)
            val lock = runCatching { channel.tryLock() }.getOrNull()
            if (lock == null) {
                channel.close()
                runCatching {
                    val port = Files.readString(portFile).trim().toInt()
                    Socket(InetAddress.getLoopbackAddress(), port).use { it.getOutputStream().write('s'.code) }
                }
                return null
            }
            val server = ServerSocket(0, 4, InetAddress.getLoopbackAddress())
            Files.writeString(portFile, server.localPort.toString())
            Thread({
                while (!server.isClosed) {
                    runCatching { server.accept().use { onShow() } }
                }
            }, "romsafe-instance").apply { isDaemon = true }.start()
            return SingleInstance(lock, server)
        }
    }
}
