#include <cstdint>

enum SensorErrorCode : uint8_t {
  SENSOR_OK = 0,
  SENSOR_ERR_OPEN = 1,
  SENSOR_ERR_SHORT_GND = 2,
  SENSOR_ERR_SHORT_VCC = 3,
  SENSOR_ERR_UNKNOWN = 255
};

void startSensors();
void takeReadings();
bool getETBTReadings(float *readings);
unsigned long getLastSensorUpdateMs();
SensorErrorCode getExhaustSensorError();
SensorErrorCode getBeanSensorError();
