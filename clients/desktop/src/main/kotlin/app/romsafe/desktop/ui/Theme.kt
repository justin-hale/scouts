package app.romsafe.desktop.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// The web GUI's palette: Tailwind stone greys with the teal brand colour.
object Stone {
    val s50 = Color(0xFFFAFAF9)
    val s100 = Color(0xFFF5F5F4)
    val s200 = Color(0xFFE7E5E4)
    val s300 = Color(0xFFD6D3D1)
    val s400 = Color(0xFFA8A29E)
    val s500 = Color(0xFF78716C)
    val s600 = Color(0xFF57534E)
    val s700 = Color(0xFF44403C)
    val s800 = Color(0xFF292524)
    val s900 = Color(0xFF1C1917)
    val s950 = Color(0xFF0C0A09)
}

object Brand {
    val b100 = Color(0xFFCCFBF1)
    val b300 = Color(0xFF5EEAD4)
    val b400 = Color(0xFF2DD4BF)
    val b500 = Color(0xFF14B8A6)
    val b600 = Color(0xFF0D9488)
    val b700 = Color(0xFF0F766E)
    val b900 = Color(0xFF134E4A)
    val b950 = Color(0xFF042F2E)
}

val Warning = Color(0xFFFBBF24)

private val colors = darkColorScheme(
    primary = Brand.b600,
    onPrimary = Color.White,
    primaryContainer = Brand.b900,
    onPrimaryContainer = Brand.b100,
    inversePrimary = Brand.b700,
    secondary = Brand.b400,
    onSecondary = Brand.b950,
    secondaryContainer = Brand.b900,
    onSecondaryContainer = Brand.b100,
    tertiary = Brand.b300,
    background = Stone.s950,
    onBackground = Stone.s200,
    surface = Stone.s950,
    onSurface = Stone.s200,
    surfaceVariant = Stone.s800,
    onSurfaceVariant = Stone.s400,
    surfaceContainerLowest = Stone.s950,
    surfaceContainerLow = Stone.s900,
    surfaceContainer = Stone.s900,
    surfaceContainerHigh = Stone.s800,
    surfaceContainerHighest = Stone.s800,
    surfaceBright = Stone.s800,
    surfaceDim = Stone.s950,
    inverseSurface = Stone.s100,
    inverseOnSurface = Stone.s900,
    outline = Stone.s700,
    outlineVariant = Stone.s800,
    error = Color(0xFFF87171),
    onError = Color(0xFF450A0A),
    errorContainer = Color(0xFF450A0A),
    onErrorContainer = Color(0xFFFECACA),
)

@Composable
fun RomSafeTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = colors, content = content)
}
