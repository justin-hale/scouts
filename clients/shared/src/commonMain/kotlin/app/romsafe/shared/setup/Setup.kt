package app.romsafe.shared.setup

import app.romsafe.shared.api.DeviceConfig
import app.romsafe.shared.api.Mapping
import app.romsafe.shared.api.PlatformInfo
import kotlinx.serialization.Serializable

/**
 * One emulator this device uses for a platform. [slot] tells the server which
 * one it is when several share a platform ("" for the first). Folder locations
 * are whatever the app can reopen: a SAF tree URI on Android, a path on desktop.
 */
@Serializable
data class EmulatorSetup(val slot: String, val profile: String, val saveUri: String? = null)

/** A platform's ROM folder and the emulators whose saves sync. */
@Serializable
data class PlatformSetup(val romUri: String? = null, val emulators: List<EmulatorSetup> = emptyList()) {
    fun uris(): List<String> = listOfNotNull(romUri) + emulators.mapNotNull { it.saveUri }
}

/** The mappings PUT body: one entry per emulator that has a save folder. */
fun mappingsFor(config: DeviceConfig, setups: Map<String, PlatformSetup>): List<Mapping> =
    config.platforms.flatMap { p ->
        val setup = setups[p.slug] ?: return@flatMap emptyList()
        setup.emulators.mapNotNull { e ->
            val save = e.saveUri ?: return@mapNotNull null
            if (e.profile !in p.profiles) return@mapNotNull null
            Mapping(platform = p.slug, profile = e.profile, slot = e.slot, saveRoot = save, romRoot = setup.romUri)
        }
    }

/**
 * Local setup wins: it holds the folder handles. Server mappings are only
 * adopted for a platform we have nothing for, and only for folders [usable]
 * accepts (e.g. the app's prefs were cleared but Android kept the grants).
 */
fun mergeServerMappings(
    local: Map<String, PlatformSetup>,
    config: DeviceConfig,
    usable: (String) -> Boolean,
): Map<String, PlatformSetup> {
    val merged = local.toMutableMap()
    for ((platform, mappings) in config.mappings.groupBy { it.platform }) {
        if (platform in merged) continue
        val emulators = mappings.filter { m -> m.saveRoot?.let(usable) == true }.map { EmulatorSetup(it.slot, it.profile, it.saveRoot) }
        if (emulators.isEmpty()) continue
        merged[platform] = PlatformSetup(mappings.firstNotNullOfOrNull { it.romRoot?.takeIf(usable) }, emulators)
    }
    return merged
}

/** The platform's emulators, or one unconfigured placeholder so a setup card has something to edit. */
fun Map<String, PlatformSetup>.emulatorsFor(p: PlatformInfo): List<EmulatorSetup> =
    this[p.slug]?.emulators?.takeIf { it.isNotEmpty() }
        ?: listOfNotNull(p.profiles.firstOrNull()?.let { EmulatorSetup("", it) })

/** Setup edits both apps make the same way; [Map] in, [Map] out. */
object Setups {
    fun updateEmulator(
        setups: Map<String, PlatformSetup>,
        platform: PlatformInfo,
        slot: String,
        change: (EmulatorSetup) -> EmulatorSetup,
    ): Map<String, PlatformSetup> {
        val placeholder = setups.emulatorsFor(platform)
        return update(setups, platform) { setup ->
            val emulators = setup.emulators.ifEmpty { placeholder }
            setup.copy(emulators = emulators.map { if (it.slot == slot) change(it) else it })
        }
    }

    /** Another emulator for the same platform, e.g. Citra MMJ next to Azahar. */
    fun addEmulator(setups: Map<String, PlatformSetup>, platform: PlatformInfo): Map<String, PlatformSetup> {
        val profile = platform.profiles.firstOrNull() ?: return setups
        return update(setups, platform) { setup ->
            val used = setup.emulators.map { it.slot }.toSet()
            val slot = generateSequence(2) { it + 1 }.map { it.toString() }.first { it !in used }
            setup.copy(emulators = setup.emulators + EmulatorSetup(slot, profile))
        }
    }

    fun removeEmulator(setups: Map<String, PlatformSetup>, platform: PlatformInfo, slot: String): Map<String, PlatformSetup> =
        update(setups, platform) { setup -> setup.copy(emulators = setup.emulators.filter { it.slot != slot }) }

    /** Applies [change]; a platform left with nothing but the default emulator and no folders drops out. */
    fun update(
        setups: Map<String, PlatformSetup>,
        platform: PlatformInfo,
        change: (PlatformSetup) -> PlatformSetup,
    ): Map<String, PlatformSetup> {
        val next = change(setups[platform.slug] ?: PlatformSetup())
        val untouched = next.uris().isEmpty() && next.emulators.size <= 1 &&
            next.emulators.all { it.profile == platform.profiles.firstOrNull() }
        return if (untouched) setups - platform.slug else setups + (platform.slug to next)
    }
}
