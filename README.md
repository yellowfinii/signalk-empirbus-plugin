# Signal K EmpirBus Plugin
<a href="https://www.npmjs.com/package/signalk-empirbusnxt-plugin"><img title="npm version" src="https://badgen.net/npm/v/signalk-empirbusnxt-plugin" ></a>
<a href="https://www.npmjs.com/package/signalk-empirbusnxt-plugin"><img title="npm downloads" src="https://badgen.net/npm/dt/signalk-empirbusnxt-plugin"></a>

Monitor and control an EmpirBus system via EmpirBus application specific PGN 65280 using the EmpirBus API component for 3rd party communication

This plugin relies on the "Data Model 2" to read and write the status of 2x dimmers with EmpirBus values 0..1000 and 8x switches 0|1 per instance of an EmpirBus Application Specific PGN component. The first two switches represent the state of the two dimmers.

The values of the two dimmers are expected in the 2x uword values of Data Model 2, while the status of the eight switches is expected in the 8x bit values. Find in the docs folder the EmpirBus documentation for details on how to process data models in EmpirBus programming.

The EmpirBus implementation has to use these instances in the EmpirBus Application Specific PGN component:  
“Receive from network”: X (e.g. 0, 2, 4, 6, ...)  
“Transmit to network”: X + 1 (e.g. 1, 3, 5, 7, ...)  

EmpirBus API PGN component connectors are numbered Word 1..2 + Bit 1..8. To avoid confusion Signal K device names are numbered accordingly starting from 1, not from 0.

The dimmer values and switch states are stored in the following Rest API keys:

`electrical/switches/empirbus/<instance>/<device>`  
`electrical/switches/empirbus/<instance>/<device>/state`  (true|false)  
`electrical/switches/empirbus/<instance>/<device>/level`  (0..1, dimmers only)  
`electrical/switches/empirbus/<instance>/<device>/type`   ("switch" | "dimmer")  

`electrical/switches/empirbus/<instance>/<device>/state/meta/units`   ("bool")  
`electrical/switches/empirbus/<instance>/<device>/state/meta/displayName`   (System name of control. While instances start with 0, in EmpirBus devices are numbered 1..8, so device names numbered accordingly 1..8, e.g. Switch 0.8)  
`electrical/switches/empirbus/<instance>/<device>/state/meta/associatedDevice/instance` (Technical device address: Instance in EmpirBus API)   
`electrical/switches/empirbus/<instance>/<device>/state/meta/associatedDevice/device` (Technical device address: Device in instance in EmpirBus API e.g. "switch 3" or "dimmer 1")  

`electrical/switches/empirbus/<instance>/<device>/level/meta/units`   ("ratio")  
`electrical/switches/empirbus/<instance>/<device>/level/meta/description`   ("Dimmer brightness ratio, 0<=ratio<=1, 1 is 100%")  
`electrical/switches/empirbus/<instance>/<device>/level/meta/displayName`   (System name of brightness, e.g. "Dimmer 0.1 brightness")  

`<instance>` is the instance of the respective “Receive from network” EmpirBus API component for 3rd party communication 0..49  
`<device>` is the connector number in that instance  
Devices `1` and `2` are dimmers and expose `state`, `level`, and `type`  
Devices `3` through `8` are switches and expose `state` and `type`  
`state` is state of switch or dimmer 'on' or 'off'  
`level` is the dimming value of dimmer as a ratio from 0 to 1, where 1 = 100%  
`associatedDevice` is the address of device proprietary to the plugin and digital switching system, e.g. for EmpirBus   `{"instance":0,"device":"switch 3"}` or `{"instance":0,"device":"dimmer 1"}`

Expanded per-instance mode also publishes the two uwords as 16-bit switch banks:

- `electrical.switches.empirbus.<instance>.w1.b01.state`
- `electrical.switches.empirbus.<instance>.w1.b16.state`
- `electrical.switches.empirbus.<instance>.w2.b01.state`
- `electrical.switches.empirbus.<instance>.w2.b16.state`

In expanded mode, compact channels `1` and `2` are also published as switches, so they expose `state` and `type` only and no `level`.

Public numbering is 1-based and zero-padded for ordering, so `b01` maps to internal bit `0` and `b16` maps to internal bit `15`.


Values to send to device are expected via PUT method at: `electrical/switches/empirbus/<instance>/<device>/state|level` with `body: JSON.stringify({value: value})`
e.g. `electrical/switches/empirbus/0/1/level`, body: `{ "value": 0.75 }`  

In expanded mode, writable word-bit paths use the same PUT format:

- `electrical/switches/empirbus/0/w1/b03/state`, body: `{ "value": false }`

## Plugin Settings

The plugin can override metadata and suppress unused devices through Signal K plugin configuration.

Available settings:

- `general`: general plugin behavior
- `ignoredPaths`: array of full EmpirBus device paths to skip entirely
- `instances`: per-instance mode and expanded word-bit channel settings

General settings:

- `publishTypePaths`: include or suppress `.type` values, default `true`

Ignored paths are not emitted into Signal K and do not get PUT handlers registered.

Instance modes:

- `Data Model 2 - Default`: current compact API only
- `Data Model 2 - Expanded`: current compact API plus `w1.b01..b16` and `w2.b01..b16`

Expanded channels are enabled by default. Each channel can override:

- `enabled`: publish the signal and register PUT when applicable
- `kind`: `switch` or `indicator`
- `displayName`: metadata display name override

Example configuration:

```json
{
  "general": {
    "publishTypePaths": true
  },
  "ignoredPaths": [
    "electrical.switches.empirbus.0.8"
  ],
  "instances": [
    {
      "transmitInstance": 1,
      "mode": "Data Model 2 - Expanded",
      "channels": {
        "w1.b01": {
          "kind": "indicator",
          "displayName": "Gen Running"
        },
        "w1.b02": {
          "enabled": false
        },
        "w2.b15": {
          "displayName": "Aux Feed"
        }
      }
    }
  ]
}
```
