package app.romsafe.shared.api

import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.java.Java

actual fun defaultHttpEngine(): HttpClientEngine = Java.create()
