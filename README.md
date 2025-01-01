# Yaeger
## Yet another embedded gourmet experience roaster
### or something like that


## The gist

Yaeger is an embedded computer that takes control of your "coffee roaster" via Artisan-Scope.
It currently supports reading data from two temperature probes as well as controlling a fan and pulsing a heater.

### Primary goal
Is to use an old popcorn popper you have gathering dust in your basement and modifying it into a sample roaster for
roasting small batches of coffee at a time.

### Suported hardware:

* ESP32-S3 (devkit-1) or an S3-mini
* 1 or 2 MAX31855 thermocouple chips
* 1 DC pwm capable dimmer for the fan (must support 3.3v control)
* 1 DC controlled AC SSR for controling the heating element (same as above)

### Command and control
This repo includes a sample config for Artisan-Scope. In order for Yaeger to connect to your wifi, add a `Credentials.h`
file in the `src` dir and add data in the following format:
```
const char *ssid = "Wifi";
const char *password = "WifiPassword";
```

Load the config in Artisan-Scope, change the server ip to match yours and click the on button. 

#### Using Yaeger on the go
If you're out and about, without access to a Wifi, Yaeger can create its own access point. Add a define `#define EASY_AP` in the `config.h` file and you will be able to join the Yaeger wifi network. The ip of Yaeger is in this case `192.168.4.1`. 


# Disclaimer
Be careful when messing about with electronics and high voltage. I can not and will not take any responsibility for any
sort of damage or injury caused by Yaeger, either directly or indirectly.
**You do this at your own risk**
### You have been warned!
