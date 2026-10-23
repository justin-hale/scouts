package app.romsafe.android

import android.app.Application
import app.romsafe.android.data.DeviceStore
import app.romsafe.android.sync.SyncRunner
import app.romsafe.android.sync.SyncWorker

class RomSafeApp : Application() {
    val store by lazy { DeviceStore(this) }

    override fun onCreate() {
        super.onCreate()
        SyncRunner.init(this)
        if (store.pairing() != null) SyncWorker.schedule(this)
    }
}
