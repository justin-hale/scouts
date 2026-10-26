package app.romsafe.desktop.ui

import java.io.File
import javax.swing.JFileChooser
import javax.swing.UIManager

/**
 * The system folder chooser. Swing's, in the platform look, because AWT's
 * native FileDialog can't pick folders on Windows. Blocks until it closes,
 * which is fine on the UI thread: Swing keeps painting behind a modal dialog.
 */
object FolderChooser {
    init {
        runCatching { UIManager.setLookAndFeel(UIManager.getSystemLookAndFeelClassName()) }
    }

    /** Opens at [start] (or the nearest folder above it that exists); null when cancelled. */
    fun choose(title: String, start: String?): String? {
        val chooser = JFileChooser().apply {
            dialogTitle = title
            fileSelectionMode = JFileChooser.DIRECTORIES_ONLY
            isAcceptAllFileFilterUsed = false
            start?.let { s -> generateSequence(File(s)) { it.parentFile }.firstOrNull { it.isDirectory } }?.let {
                // Opening *at* the folder selects it, so "Choose" on an already-right folder just works.
                currentDirectory = it.parentFile ?: it
                selectedFile = it
            }
        }
        return if (chooser.showDialog(null, "Choose folder") == JFileChooser.APPROVE_OPTION) {
            chooser.selectedFile?.absolutePath
        } else {
            null
        }
    }
}
