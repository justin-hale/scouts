package app.romsafe.android

import android.app.Application
import app.romsafe.android.data.DeviceStore
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.svg.SvgDecoder
import app.romsafe.android.sync.SyncRunner
import app.romsafe.android.sync.SyncWorker

class RomSafeApp : Application(), SingletonImageLoader.Factory {
    val store by lazy { DeviceStore(this) }

    override fun onCreate() {
        super.onCreate()
        SyncRunner.init(this)
        if (store.pairing() != null) SyncWorker.schedule(this)
    }

    // Platform logos are SVGs (the web GUI's own files).
    override fun newImageLoader(context: PlatformContext): ImageLoader =
        ImageLoader.Builder(context).components { add(SvgDecoder.Factory()) }.build()
}
