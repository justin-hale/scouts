package app.romsafe.shared.sync

import app.romsafe.shared.api.SaveRule

/**
 * Client-side copy of the server's path templates (docs/emulator-profiles.md),
 * used only to decide which files are worth hashing and which folders worth
 * walking: a DS save folder may also hold 500 MB ROMs, and a 3DS sdmc folder
 * holds installed games. The server still has the final say on every path.
 */
class SaveMatcher(rules: List<SaveRule>) {
    private val full = rules.map { Regex("^" + toRegex(it.pattern) + "$", RegexOption.IGNORE_CASE) }

    /** Per rule, a regex per path segment; null for a `{name**}` segment, which matches any depth. */
    private val segments: List<List<Regex?>> = rules.map { rule ->
        rule.pattern.split('/').map { seg ->
            if (seg.contains("**}")) null else Regex("^" + toRegex(seg) + "$", RegexOption.IGNORE_CASE)
        }
    }

    fun matches(path: String): Boolean = full.any { it.matches(path) }

    /** Whether a folder at [dir] could contain a matching file. */
    fun mayContain(dir: String): Boolean {
        val parts = dir.split('/')
        return segments.any { segs -> prefixMatches(segs, parts) }
    }

    private fun prefixMatches(segs: List<Regex?>, parts: List<String>): Boolean {
        for ((i, part) in parts.withIndex()) {
            if (i >= segs.size) return false
            val seg = segs[i] ?: return true
            // The last segment names the file, so no folder can match it.
            if (i == segs.lastIndex || !seg.matches(part)) return false
        }
        return true
    }

    private companion object {
        val token = Regex("""\{(\w+)(\*\*|:(\d+))?\}""")

        fun toRegex(pattern: String): String {
            val out = StringBuilder()
            var last = 0
            for (m in token.findAll(pattern)) {
                out.append(Regex.escape(pattern.substring(last, m.range.first)))
                val (_, modifier, width) = m.destructured
                out.append(
                    when {
                        modifier == "**" -> ".+"
                        width.isNotEmpty() -> "[^/]{$width}"
                        else -> "[^/]+"
                    },
                )
                last = m.range.last + 1
            }
            out.append(Regex.escape(pattern.substring(last)))
            return out.toString()
        }
    }
}
