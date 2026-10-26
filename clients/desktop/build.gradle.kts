import org.jetbrains.compose.desktop.application.dsl.TargetFormat

plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.jetbrains.compose)
}

val commitCount = providers.exec {
    commandLine("git", "rev-list", "--count", "HEAD")
    isIgnoreExitValue = true
}.standardOutput.asText.map { it.trim().toIntOrNull() ?: 1 }

kotlin {
    jvmToolchain(21)
}

dependencies {
    implementation(project(":shared"))
    implementation(compose.desktop.currentOs)
    implementation(compose.material3)
    implementation(libs.cmp.material.icons.core)
    implementation(libs.kotlinx.coroutines.swing)
    implementation(libs.ktor.client.java)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.ktor3)
    // DPAPI, to keep the device token encrypted at rest on Windows.
    implementation(libs.jna.platform)

    testImplementation(libs.kotlin.test)
    testImplementation(libs.kotlinx.coroutines.test)
}

compose.desktop {
    application {
        mainClass = "app.romsafe.desktop.MainKt"
        nativeDistributions {
            targetFormats(TargetFormat.Msi, TargetFormat.Dmg, TargetFormat.Deb)
            packageName = "RomSafe"
            description = "Save sync and ROM library client for a RomSafe server"
            vendor = "RomSafe"
            // MSI versions are MAJOR.MINOR.BUILD with BUILD at most 65535: one build per commit.
            packageVersion = "1.0.${commitCount.get()}"
            modules("java.instrument", "java.management", "java.net.http", "jdk.unsupported")
            windows {
                menu = true
                shortcut = true
                perUserInstall = true
                // Never change this: it is how Windows Installer recognises an upgrade.
                upgradeUuid = "6f1c2b1e-5a8f-4b52-9d1e-3f0c2a7d9b41"
                iconFile.set(project.file("icons/romsafe.ico"))
            }
            macOS {
                bundleID = "app.romsafe.desktop"
            }
        }
    }
}
