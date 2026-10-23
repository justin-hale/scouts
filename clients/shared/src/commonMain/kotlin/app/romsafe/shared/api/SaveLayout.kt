package app.romsafe.shared.api

/**
 * What a profile expects inside the folder the user picks, so the apps can show
 * an example and catch a folder picked one level too deep or too shallow.
 */
object SaveLayout {
    private val token = Regex("""\{(\w+)(\*\*|:\d+)?\}""")

    /** The profile's rules for [platform]; `*` covers every ROM-keyed platform. */
    fun rules(profile: Profile, platform: PlatformInfo): List<SaveRule> =
        profile.saves.filter { platform.slug in it.platforms || ("*" in it.platforms && platform.keyKind == "rom") }

    /** Example paths relative to the picked folder, one per rule, e.g. "GC/USA/Card A/" plus a wildcard file name. */
    fun examples(profile: Profile, platform: PlatformInfo): List<String> =
        rules(profile, platform).map { rule ->
            token.replace(rule.pattern) { m -> sample(m.groupValues[1], m.groupValues[2], platform.slug) }
        }.distinct()

    /**
     * Folder names that must sit directly inside the picked folder ("Nintendo 3DS",
     * "GC"). Empty when saves sit in the picked folder itself, as with RetroArch.
     */
    fun topFolders(profile: Profile, platform: PlatformInfo): Set<String> =
        rules(profile, platform).mapNotNullTo(mutableSetOf()) { rule ->
            rule.pattern.substringBefore('/', "").takeIf { it.isNotEmpty() && '{' !in it }
        }

    private fun sample(name: String, modifier: String, platform: String): String = when (name) {
        "game" -> "Game Name"
        "file" -> if (modifier == "**") "…" else "*"
        "id0", "id1" -> "0000…0000"
        "category" -> if (platform == "wii") "00010000" else "00040000"
        "titleLow" -> if (platform == "wii") "52534245" else "00055D00"
        "region" -> "USA"
        "slot" -> "A"
        "saveDir" -> "ULUS10041"
        "card" -> if (platform == "dreamcast") "A1" else "Mcd001"
        else -> name
    }
}
