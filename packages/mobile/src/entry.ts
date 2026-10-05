// Module order is the boot order: the mobile main side registers every IPC
// handler (awaiting native state at top level), then the unchanged desktop
// preload exposes the window globals, then the desktop renderer mounts.
import './main/index'
import '../../desktop/src/preload/index'
import '@/main'
