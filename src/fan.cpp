#include "fan.h"
#include "FreeRTOS.h"
#include "config.h"
#include "logging.h"
#include "projdefs.h"
#include "queue.h"
#include "semphr.h"
#include "task.h"

#define RAMP_DELAY_MS 50

/*SemaphoreHandle_t fanMutex; // Mutex to protect currentFanSpeed*/
QueueHandle_t speedQueue;
int currentFanSpeed = 0;
int targetSpeed = 0;

void rampFanSpeedTask(void *pvParams);
// Initialize the fan
// This function should be called in the setup function
void initFan() {
  analogWrite(FAN_PIN, 0);
  /*fanMutex = xSemaphoreCreateMutex();*/
  speedQueue = xQueueCreate(1, sizeof(int));

  xTaskCreate(rampFanSpeedTask, "FanRampTask", configMINIMAL_STACK_SIZE + 2048,
              NULL, 1, NULL);
}

// set the fan speed
// speed: the speed of the fan, from 0 to 100
// 0 means the fan is off, 100 means the fan is at full speed
void setFanSpeed(int speed) {
  if (speed < 0) {
    speed = 0;
  } else if (speed > 100) {
    speed = 100;
  }
  targetSpeed = speed;

  logf("Fan speed set to %d%%\n", speed);
  if (xQueueOverwrite(speedQueue, &speed) == pdPASS) {
    logf("Requested fan speed set to %d%%\n", speed);
  }
}

int getFanSpeed() { return targetSpeed; }

void rampFanSpeedTask(void *pvParams) {
  int desiredSpeed = 0;

  while (true) {
    // Wait for a new target speed from the queue
    if (xQueueReceive(speedQueue, &desiredSpeed, portMAX_DELAY) == pdPASS) {
      while (true) {

        // Gradually adjust the speed
        if (currentFanSpeed < desiredSpeed) {
          currentFanSpeed++;
        } else if (currentFanSpeed > desiredSpeed) {
          currentFanSpeed--;
        }

        analogWrite(FAN_PIN, currentFanSpeed * 255 / 100);
        logf("Fan speed updated to %d%%\n", currentFanSpeed);

        // Break if the target speed is reached
        if (currentFanSpeed == desiredSpeed) {
          break;
        }

        vTaskDelay(pdMS_TO_TICKS(RAMP_DELAY_MS)); // Delay between adjustments
      }
    }
  }
}
