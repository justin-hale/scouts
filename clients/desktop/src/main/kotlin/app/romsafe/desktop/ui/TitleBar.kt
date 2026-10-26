package app.romsafe.desktop.ui

import com.sun.jna.Native
import com.sun.jna.Pointer
import com.sun.jna.platform.win32.WinDef
import com.sun.jna.ptr.IntByReference
import com.sun.jna.win32.StdCallLibrary
import java.awt.Window

/** Windows 11 draws a light title bar unless asked; this makes it match the app's stone background. */
object TitleBar {
    @Suppress("FunctionName")
    private interface Dwmapi : StdCallLibrary {
        fun DwmSetWindowAttribute(hwnd: WinDef.HWND, attribute: Int, value: IntByReference, size: Int): Int
    }

    private const val USE_IMMERSIVE_DARK_MODE = 20
    private const val CAPTION_COLOR = 35

    // Stone 950 as a COLORREF (0x00BBGGRR).
    private const val STONE_950 = 0x00090A0C

    fun darken(window: Window) {
        if (!System.getProperty("os.name").startsWith("Windows", ignoreCase = true)) return
        runCatching {
            val dwm = Native.load("dwmapi", Dwmapi::class.java)
            val hwnd = WinDef.HWND(Pointer(Native.getWindowID(window)))
            dwm.DwmSetWindowAttribute(hwnd, USE_IMMERSIVE_DARK_MODE, IntByReference(1), 4)
            // Windows 10 ignores this one; there the dark mode above is enough.
            dwm.DwmSetWindowAttribute(hwnd, CAPTION_COLOR, IntByReference(STONE_950), 4)
        }
    }
}
