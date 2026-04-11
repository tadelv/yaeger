#include "config.h"

#if ENABLE_LCD
void initDisplay();
void setWifiIP();
void updateDisplaySensorStatus();
#else
inline void initDisplay() {}
inline void setWifiIP() {}
inline void updateDisplaySensorStatus() {}
#endif
