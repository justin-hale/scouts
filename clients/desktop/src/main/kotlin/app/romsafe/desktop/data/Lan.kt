package app.romsafe.desktop.data

import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress

/**
 * Cleartext HTTP is only acceptable when it can't leave the home network. The
 * same rule as the Android app: plain http only to private, loopback or
 * Tailscale addresses.
 */
object Lan {
    /** Resolves [host] (blocking) and checks every address it maps to. */
    fun isPrivateHost(host: String): Boolean {
        val addresses = InetAddress.getAllByName(host)
        return addresses.isNotEmpty() && addresses.all(::isPrivate)
    }

    fun isPrivate(a: InetAddress): Boolean {
        if (a.isLoopbackAddress || a.isSiteLocalAddress || a.isLinkLocalAddress) return true
        val b = a.address
        return when (a) {
            // 100.64.0.0/10: carrier-grade NAT, which is what Tailscale hands out.
            is Inet4Address -> (b[0].toInt() and 0xff) == 100 && (b[1].toInt() and 0xc0) == 64
            // fc00::/7: unique local IPv6 addresses.
            is Inet6Address -> (b[0].toInt() and 0xfe) == 0xfc
            else -> false
        }
    }
}
