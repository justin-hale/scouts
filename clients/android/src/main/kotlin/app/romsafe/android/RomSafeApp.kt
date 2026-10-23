package app.romsafe.android

import android.app.Application
import app.romsafe.android.data.DeviceStore

class RomSafeApp : Application() {
    val store by lazy { DeviceStore(this) }
}
