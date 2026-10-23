package app.romsafe.shared.api

import kotlin.test.Test
import kotlin.test.assertEquals

class SaveLayoutTest {
    private val gc = PlatformInfo("gc", "GameCube", "card")
    private val gba = PlatformInfo("gba", "Game Boy Advance", "rom")
    private val dolphin = Profile(
        "dolphin",
        "Dolphin",
        saves = listOf(
            SaveRule(listOf("gc"), "GC/MemoryCard{slot:1}.{region}.raw", file = "card.raw"),
            SaveRule(listOf("gc"), "GC/{region}/Card {slot:1}/{file}"),
            SaveRule(listOf("wii"), "Wii/title/{category:8}/{titleLow:8}/data/{file**}"),
        ),
    )
    private val retroarch = Profile("retroarch", "RetroArch", saves = listOf(SaveRule(listOf("*"), "{game}.srm", file = "battery.sav")))

    @Test
    fun examplesOnlyCoverThePlatform() {
        assertEquals(listOf("GC/MemoryCardA.USA.raw", "GC/USA/Card A/*"), SaveLayout.examples(dolphin, gc))
        assertEquals(setOf("GC"), SaveLayout.topFolders(dolphin, gc))
    }

    @Test
    fun wildcardRulesApplyToRomKeyedPlatforms() {
        assertEquals(listOf("Game Name.srm"), SaveLayout.examples(retroarch, gba))
        assertEquals(emptySet(), SaveLayout.topFolders(retroarch, gba))
        assertEquals(emptyList(), SaveLayout.examples(retroarch, gc))
    }
}
