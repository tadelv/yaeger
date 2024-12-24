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

#define HEATER_PIN 4 //changed to pin 4 as pin 3 is EN

// temp sensor pins

//Exhaust
#define MAX1DO 5
#define MAX1CS 15
#define MAX1CLK 6

//Beans
#define MAX2DO 5
#define MAX2CS 16
#define MAX2CLK 6

#define DISPLAY_DA 41
#define DISPLAY_CL 42
#endif

#define DEBUG
#define EASY_AP
