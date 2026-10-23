package app.romsafe.shared.api

import io.ktor.client.engine.HttpClientEngine

/** OkHttp on Android, the JDK client on desktop. */
expect fun defaultHttpEngine(): HttpClientEngine

object ServerUrl {
    /**
     * Accepts what people actually type ("192.168.1.20:8080", "romsafe.lan/")
     * and returns a base URL without a trailing slash. Plain hosts get `http://`
     * because a home server on the LAN usually has no certificate.
     */
    fun normalize(input: String): String {
        var url = input.trim()
        if (!Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://").containsMatchIn(url)) url = "http://$url"
        return url.trimEnd('/')
    }

    /** The host part of a normalized URL, without port or brackets. */
    fun host(url: String): String {
        val rest = normalize(url).substringAfter("://").substringBefore('/').substringAfter('@')
        return if (rest.startsWith("[")) rest.substringAfter('[').substringBefore(']') else rest.substringBefore(':')
    }

    fun isHttps(url: String): Boolean = normalize(url).startsWith("https://", ignoreCase = true)
}
