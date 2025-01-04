# Yaeger
![yaeger logo](./assets/logo.webp)
## Yet another embedded gourmet experience roaster
### or something like that


## The gist

Yaeger is an embedded computer that takes control of your "coffee roaster" via Artisan-Scope.
It currently supports reading data from two temperature probes as well as controlling a fan and pulsing a heater.

### Primary goal
Is to use an old popcorn popper you have gathering dust in your basement and modifying it into a sample roaster for
roasting small batches of coffee at a time.

### Suported hardware:

* [ESP32-S3 (devkit-1)](https://www.aliexpress.com/item/1005006266375800.html) or an [S3-mini](https://www.aliexpress.com/item/1005006177646698.html)
* 1 or 2 [MAX31855](https://www.aliexpress.com/item/1005006381598473.html) thermocouple chips
* 1 [DC pwm capable dimmer](https://www.aliexpress.com/item/1005006457613501.html) for the fan (must support 3.3v control)
* 1 DC controlled [AC SSR](https://www.aliexpress.com/item/4000045425145.html) for controling the heating element (same as above)


### Other required hardware for the build:

* 18V DC PSU for driving the fan
* regular wire K-type thermocouple probe (the one that comes with your multimeter)
* flexible K-type thermocouple probe, 1x50/1.5x50 (sometimes difficult to source, they come and go on aliexpress, search for
flexible thermocouple 1x100 - this usually works)

#### Optional upgrades:

* 24V DC PSU for more fan power

### Command and control
This repo includes a sample config for Artisan-Scope. In order for Yaeger to connect to your wifi, add a `Credentials.h`
file in the `src` dir and add data in the following format:
```
const char *ssid = "Wifi";
const char *password = "WifiPassword";
```

#### Artisan Scope
Load the config, found in `./artisan-settings.aset` into Artisan-Scope, change the server ip to match yours and click the on button. 

#### Web interface
You can also control Yaeger from its own web interface without an app. Just point your browser to `yaeger.local` when on
your home wifi, or `192.168.4.1` if Yaeger creates its own access point.
![yaeger webui](./assets/yaeger-webui.png)

#### Using Yaeger on the go
If you're out and about, without access to a Wifi, Yaeger can create its own access point. Add a define `#define EASY_AP` in the `config.h` file and you will be able to join the Yaeger wifi network. The ip of Yaeger is in this case `192.168.4.1`. 


## Build guide (WIP)

### Schema
![schema](./schema/Schematic_Yaeger_2024-12-24.svg)

# Disclaimer
Be careful when messing about with electronics and high voltage. I can not and will not take any responsibility for any
sort of damage or injury caused by Yaeger, either directly or indirectly.
**You do this at your own risk**
### You have been warned!
