package app.romsafe.android.ui

import androidx.compose.foundation.layout.Box
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.romsafe.android.ui.theme.Stone
import coil3.compose.AsyncImage
import coil3.network.NetworkHeaders
import coil3.network.httpHeaders
import coil3.request.ImageRequest
import coil3.request.crossfade

/** Where covers and logos come from: the paired server, with the device's token for covers. */
data class ArtSource(val serverUrl: String, val authHeader: String?) {
    fun cover(file: String?) = file?.let { "$serverUrl/api/covers/$it" }
    fun logo(slug: String) = "$serverUrl/platforms/$slug.svg"
}

/** A cached cover, or the title on a plain tile when the game has none. */
@Composable
fun Cover(art: ArtSource, file: String?, title: String, modifier: Modifier = Modifier.fillMaxSize()) {
    val context = LocalContext.current
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

/** A platform's logo from the server's /platforms/<slug>.svg, or its name when there's none. */
@Composable
fun PlatformLogo(art: ArtSource, slug: String, name: String, modifier: Modifier = Modifier, scale: Float = 1f) {
    var missing by remember(slug) { mutableStateOf(false) }
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
    AsyncImage(
        model = art.logo(slug),
        contentDescription = name,
        contentScale = ContentScale.Fit,
        alignment = Alignment.CenterStart,
        colorFilter = if (slug in COLOUR_LOGOS) null else WHITE,
        onError = { missing = true },
        modifier = modifier.height((if (slug in TALL_LOGOS) 26 else 18).dp * scale),
    )
}
