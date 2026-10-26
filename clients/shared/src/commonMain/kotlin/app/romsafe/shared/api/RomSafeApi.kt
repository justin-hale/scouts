package app.romsafe.shared.api

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.request.bearerAuth
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.prepareGet
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsBytes
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import io.ktor.utils.io.ByteReadChannel
import kotlinx.serialization.json.Json

/** A non-2xx answer from the server, with its `{ error }` message when it sent one. */
class RomSafeApiException(val status: Int, message: String) : Exception(message)

internal class RomStream(val resumed: Boolean, val length: Long?, val channel: ByteReadChannel)

/** A downloaded save version and the hash the server says it has. */
class SaveDownload(val bytes: ByteArray, val sha256: String?)

/**
 * Client for the device API in docs/sync-protocol.md. One instance per server;
 * [token] is null only for pairing.
 */
class RomSafeApi(
    baseUrl: String,
    private val token: String?,
    engine: HttpClientEngine = defaultHttpEngine(),
) : AutoCloseable {
    val baseUrl: String = ServerUrl.normalize(baseUrl)

    private val client = HttpClient(engine) {
        expectSuccess = false
        install(ContentNegotiation) { json(RomSafeApi.json) }
        install(HttpTimeout) {
            connectTimeoutMillis = 10_000
            // Large save files over a slow Wi-Fi link still finish; a dead socket doesn't hang forever.
            socketTimeoutMillis = 60_000
        }
        defaultRequest {
            url(this@RomSafeApi.baseUrl + "/")
            token?.let { bearerAuth(it) }
        }
    }

    suspend fun pair(code: String, name: String, kind: String): PairResponse =
        client.post("api/device/pair") {
            contentType(ContentType.Application.Json)
            setBody(PairRequest(code, name, kind))
        }.ok()

    suspend fun config(): DeviceConfig = client.get("api/device/config").ok()

    suspend fun putMappings(mappings: List<Mapping>) {
        client.put("api/device/mappings") {
            contentType(ContentType.Application.Json)
            setBody(MappingsRequest(mappings))
        }.ok<Unit>()
    }

    suspend fun inventory(platform: String, files: List<InventoryFile>, complete: Boolean = true): List<InventoryResult> =
        client.post("api/device/roms/inventory") {
            contentType(ContentType.Application.Json)
            setBody(InventoryRequest(platform, complete, files))
        }.ok<InventoryResponse>().results

    suspend fun roms(platform: String): List<ServerRom> =
        client.get("api/device/roms") { parameter("platform", platform) }.ok()

    suspend fun queue(): List<QueuedRom> = client.get("api/device/roms/queue").ok()

    suspend fun games(platform: String): List<LibraryGame> =
        client.get("api/device/games") { parameter("platform", platform) }.ok()

    /** The whole library grouped by platform, sorted by the server. */
    suspend fun library(
        sort: GameSort = GameSort.TITLE,
        platformSort: PlatformSort = PlatformSort.NAME,
        platform: String? = null,
        query: String? = null,
    ): Library =
        client.get("api/device/library") {
            parameter("sort", sort.wire)
            parameter("platformSort", platformSort.wire)
            platform?.let { parameter("platform", it) }
            query?.takeIf { it.isNotBlank() }?.let { parameter("q", it.trim()) }
        }.ok()

    /** A game page: metadata, ROM files, extras and saves. */
    suspend fun game(id: Long): GameDetail = client.get("api/games/$id").ok()

    /** A save's history, newest first. */
    suspend fun saveVersions(saveId: Long): List<SaveVersion> = client.get("api/saves/$saveId/versions").ok()

    /** Absolute URL of a cover the server cached; fetch it with [authHeader]. */
    fun coverUrl(file: String): String = "$baseUrl/api/covers/$file"

    /** A platform's logo (SVG, public). Not every platform has one, so expect a 404. */
    fun platformLogoUrl(slug: String): String = "$baseUrl/platforms/$slug.svg"

    val authHeader: String? get() = token?.let { "Bearer $it" }

    /**
     * Streams a ROM download into [read]. With [from] > 0 it asks for the rest
     * of the file; [RomStream.resumed] says whether the server honoured that
     * (multi-file zips are always sent whole).
     */
    internal suspend fun <T> downloadRom(romId: Long, from: Long, read: suspend (RomStream) -> T): T =
        client.prepareGet("api/roms/$romId/download") {
            if (from > 0) headers.append(HttpHeaders.Range, "bytes=$from-")
        }.execute { res ->
            if (!res.status.isSuccess()) res.ok<Unit>()
            val resumed = res.status == HttpStatusCode.PartialContent
            val length = res.headers[HttpHeaders.ContentLength]?.toLongOrNull()
            read(RomStream(resumed, length, res.body<ByteReadChannel>()))
        }

    suspend fun enqueue(romIds: List<Long>) {
        client.post("api/device/roms/queue") {
            contentType(ContentType.Application.Json)
            setBody(QueueRequest(romIds))
        }.ok<Unit>()
    }

    suspend fun dequeue(romId: Long) {
        client.delete("api/device/roms/queue/$romId").ok<Unit>()
    }

    suspend fun plan(platform: String, files: List<LocalSave>, slot: String = ""): List<SyncAction> =
        client.post("api/device/saves/plan") {
            contentType(ContentType.Application.Json)
            setBody(PlanRequest(platform, files, slot))
        }.ok<PlanResponse>().actions

    suspend fun upload(
        platform: String,
        path: String,
        bytes: ByteArray,
        base: Long?,
        conflict: Boolean = false,
        slot: String = "",
        /** The file's modified time (ms), shown on the Conflicts page to tell which copy is newer. */
        modified: Long? = null,
    ): UploadResponse =
        client.put("api/device/saves/upload") {
            parameter("platform", platform)
            parameter("path", path)
            base?.let { parameter("base", it) }
            if (conflict) parameter("conflict", 1)
            if (slot.isNotEmpty()) parameter("slot", slot)
            modified?.let { parameter("modified", it) }
            contentType(ContentType.Application.OctetStream)
            setBody(bytes)
        }.ok()

    suspend fun downloadSave(versionId: Long): SaveDownload {
        val res = client.get("api/save-versions/$versionId/download")
        if (!res.status.isSuccess()) res.ok<Unit>()
        return SaveDownload(res.bodyAsBytes(), res.headers["X-Save-Sha256"])
    }

    suspend fun ack(saveId: Long, versionId: Long, slot: String = "") {
        client.post("api/device/saves/ack") {
            contentType(ContentType.Application.Json)
            setBody(AckRequest(saveId, versionId, slot))
        }.ok<Unit>()
    }

    override fun close() = client.close()

    private suspend inline fun <reified T> HttpResponse.ok(): T {
        if (!status.isSuccess()) {
            val text = runCatching { bodyAsText() }.getOrDefault("")
            val message = runCatching { json.decodeFromString<ErrorBody>(text).error }.getOrNull()
            throw RomSafeApiException(status.value, message ?: "Server answered ${status.value} ${status.description}")
        }
        return if (T::class == Unit::class) Unit as T else body()
    }

    companion object {
        val json = Json {
            ignoreUnknownKeys = true
            explicitNulls = false
        }
    }
}
