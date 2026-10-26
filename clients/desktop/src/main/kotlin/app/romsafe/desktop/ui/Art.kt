package app.romsafe.desktop.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.compose.AsyncImage
import coil3.compose.LocalPlatformContext
import coil3.compose.setSingletonImageLoaderFactory
import coil3.disk.DiskCache
import coil3.memory.MemoryCache
import coil3.network.NetworkHeaders
import coil3.network.httpHeaders
import coil3.network.ktor3.KtorNetworkFetcherFactory
import coil3.request.ImageRequest
import coil3.request.crossfade
import app.romsafe.desktop.data.AppDirs
import androidx.compose.foundation.Image
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.produceState
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.loadSvgPainter
import io.ktor.client.HttpClient
import io.ktor.client.engine.java.Java
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.http.isSuccess
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import okio.Path.Companion.toOkioPath
import java.util.concurrent.ConcurrentHashMap

/** Where covers and logos come from: the paired server, with the device's token for covers. */
data class ArtSource(val serverUrl: String, val authHeader: String?) {
    fun cover(file: String?) = file?.let { "$serverUrl/api/covers/$it" }
    fun logo(slug: String) = "$serverUrl/platforms/$slug.svg"
}

/** Coil for covers, with a disk cache under the app's folder, so covers don't download every launch. */
@Composable
fun ImageLoaderSetup() {
    setSingletonImageLoaderFactory { context: PlatformContext ->
        ImageLoader.Builder(context)
            .components {
                add(KtorNetworkFetcherFactory())
            }
            .memoryCache { MemoryCache.Builder().maxSizePercent(context, 0.25).build() }
            .diskCache {
                DiskCache.Builder()
                    .directory(AppDirs.data.resolve("image-cache").toOkioPath())
                    .maxSizeBytes(512L * 1024 * 1024)
                    .build()
            }
            .build()
    }
}

/** A cached cover, or the title on a plain tile when the game has none. */
@Composable
fun Cover(art: ArtSource, file: String?, title: String, modifier: Modifier = Modifier.fillMaxSize()) {
    val context = LocalPlatformContext.current
    val url = art.cover(file)
    if (url == null) {
        Box(modifier.padding(12.dp), contentAlignment = Alignment.Center) {
            Text(title, style = MaterialTheme.typography.titleSmall, color = Stone.s400, textAlign = TextAlign.Center)
        }
        return
    }
    val request = remember(url, art.authHeader) {
        ImageRequest.Builder(context)
            .data(url)
            .httpHeaders(NetworkHeaders.Builder().apply { art.authHeader?.let { set("Authorization", it) } }.build())
            .crossfade(true)
            .build()
    }
    AsyncImage(model = request, contentDescription = title, contentScale = ContentScale.Crop, modifier = modifier)
}

// As in the web GUI: most logos are drawn solid white so they read on any cover. These rely on
// filled shapes that would turn into a white blob, so they keep their colours; stacked or
// thin-lettered logos get more height.
private val COLOUR_LOGOS = setOf("nes", "gba", "genesis")
private val TALL_LOGOS = setOf("nes", "gbc", "dreamcast", "ps2", "psp")

// Every pixel white, alpha kept: the web's `brightness-0 invert`.
private val WHITE = ColorFilter.colorMatrix(
    ColorMatrix(
        floatArrayOf(
            0f, 0f, 0f, 0f, 255f,
            0f, 0f, 0f, 0f, 255f,
            0f, 0f, 0f, 0f, 255f,
            0f, 0f, 0f, 1f, 0f,
        ),
    ),
)

/**
 * Platform logos, fetched once per run. Skia's SVG renderer ignores `<style>`
 * blocks, so a shape styled `fill:none` by class would paint solid (and the
 * white filter turns it into a block); the classes are inlined first.
 */
private object Logos {
    private val client = HttpClient(Java)
    class Logo(val svg: ByteArray, /** Width over height, from the viewBox: not every logo states a size. */ val ratio: Float)

    private val cache = ConcurrentHashMap<String, Deferred<Logo?>>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    suspend fun get(url: String): Logo? = cache.getOrPut(url) {
        scope.async {
            runCatching {
                val res = client.get(url)
                if (res.status.isSuccess()) res.bodyAsText().let { Logo(withSize(inlineClasses(it)).encodeToByteArray(), ratio(it)) } else null
            }.getOrNull()
        }
    }.await()

    private val viewBox = Regex("""viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)""")

    private fun ratio(svg: String): Float {
        val (w, h) = viewBox.find(svg)?.destructured ?: return 4f
        return (w.toFloat() / h.toFloat()).takeIf { it.isFinite() && it > 0 } ?: 4f
    }

    private val svgTag = Regex("""<svg\b[^>]*>""")

    /** Skia draws an SVG without a width and height at a tiny default size; give it the viewBox's. */
    private fun withSize(svg: String): String {
        val tag = svgTag.find(svg) ?: return svg
        if (Regex("""\swidth=""").containsMatchIn(tag.value)) return svg
        val (w, h) = viewBox.find(tag.value)?.destructured ?: return svg
        return svg.replaceRange(tag.range, tag.value.replaceFirst("<svg", "<svg width=\"$w\" height=\"$h\""))
    }

    private val styleBlock = Regex("""<style[^>]*>(.*?)</style>""", RegexOption.DOT_MATCHES_ALL)
    private val rule = Regex("""\.([\w-]+)\s*\{([^}]*)\}""")
    private val classAttr = Regex("""class="([^"]*)"""")

    fun inlineClasses(svg: String): String {
        val rules = styleBlock.findAll(svg).flatMap { rule.findAll(it.groupValues[1]) }
            .associate { it.groupValues[1] to it.groupValues[2].trim().trimEnd(';') }
        if (rules.isEmpty()) return svg
        return classAttr.replace(svg) { m ->
            val decls = m.groupValues[1].split(' ').mapNotNull { rules[it] }.joinToString(";")
            if (decls.isEmpty()) m.value else "style=\"$decls\""
        }
    }
}

/** A platform's logo from the server's /platforms/<slug>.svg, or its name when there's none. */
@Composable
fun PlatformLogo(art: ArtSource, slug: String, name: String, modifier: Modifier = Modifier, scale: Float = 1f) {
    val density = LocalDensity.current
    val url = art.logo(slug)
    val loaded by produceState<Pair<Painter, Float>?>(null, url) {
        value = Logos.get(url)?.let { l -> runCatching { loadSvgPainter(l.svg.inputStream(), density) to l.ratio }.getOrNull() }
    }
    var missing by remember(slug) { mutableStateOf(false) }
    LaunchedEffect(url) { missing = Logos.get(url) == null }
    val logo = loaded
    val height = (if (slug in TALL_LOGOS) 26 else 18).dp * scale
    if (logo != null) {
        Image(
            logo.first,
            contentDescription = name,
            contentScale = ContentScale.Fit,
            alignment = Alignment.CenterStart,
            colorFilter = if (slug in COLOUR_LOGOS) null else WHITE,
            modifier = modifier.height(height).widthIn(max = height * logo.second),
        )
        return
    }
    if (missing) {
        Text(
            name,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
            color = Color.White,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = modifier,
        )
        return
    }
    // Still loading: keep the row's height so the grid doesn't jump.
    Box(modifier.height((if (slug in TALL_LOGOS) 26 else 18).dp * scale))
}

/** The Android app's vector icons, shared as XML resources. */
object AppIcons {
    val arrowBack @Composable get() = icon("ic_arrow_back")
    val checkCircle @Composable get() = icon("ic_check_circle")
    val download @Composable get() = icon("ic_download")
    val extension @Composable get() = icon("ic_extension")
    val gamepad @Composable get() = icon("ic_gamepad")
    val history @Composable get() = icon("ic_history")
    val library @Composable get() = icon("ic_library")
    val save @Composable get() = icon("ic_save")
    val sort @Composable get() = icon("ic_sort")

    @Suppress("DEPRECATION")
    @Composable
    private fun icon(name: String): Painter = painterResource("icons/$name.xml")
}

@Suppress("DEPRECATION")
@Composable
fun logoPainter(): Painter = painterResource("logo.png")
