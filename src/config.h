#ifdef S3MINI

#define FAN_PIN 21

#define HEATER_PIN 18

// temp sensor pins
#define MAX1DO 35
#define MAX1CS 37
#define MAX1CLK 33

#define MAX2DO 35
#define MAX2CS 39
#define MAX2CLK 33

#define DISPLAY_DA 41
#define DISPLAY_CL 42

#else

#define FAN_PIN 8

#define HEATER_PIN 3

// temp sensor pins

// Exhaust
#define MAX1DO 5
#define MAX1CS 15
#define MAX1CLK 6

// Beans
#define MAX2DO 5
#define MAX2CS 16
#define MAX2CLK 6

#define DISPLAY_DA 41
#define DISPLAY_CL 42
#endif

#define DEBUG false


// DEVICE PARAMETERS
#define MAX_HEATER_POWER 90
#define FAN_FREQUENCY 20000
#define HEATER_FREQUENCY 50
#define INITIAL_WIFI_SSID ""
#define INITIAL_WIFI_PASS ""

