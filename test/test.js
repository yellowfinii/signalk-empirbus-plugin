const assert = require('assert')
const EventEmitter = require('events')
const _ = require('lodash')
const chai = require('chai')

chai.Should()
chai.use(require('chai-json-equal'))

function createApp() {
  const app = new EventEmitter()
  app.handlers = []
  app.sentPgns = []

  app.debug = () => {}
  app.setPluginStatus = () => {}
  app.setPluginError = () => {}
  app.registerActionHandler = (context, path, handler) => {
    app.handlers.push({ context, path, handler })
  }
  app.handleMessage = (id, delta) => {
    app.lastMessage = { id, delta }
  }
  app.on('nmea2000out', pgn => {
    app.sentPgns.push(pgn)
  })

  return app
}

describe('EmpirBus PGN 65280 handling', () => {
  it('creates the expected delta from a decoded buffer', () => {
    const app = createApp()
    const plugin = require('../index')(app)

    const state = plugin.readDataBuffer(Buffer.from([0x00, 0xf4, 0x01, 0xe8, 0x03, 0x55]))
    const delta = plugin.createDelta(state)

    toFlat(delta).should.jsonEqual(expectedFlat)
  })

  it('emits state from YD raw canboatjs output fallback', () => {
    const app = createApp()
    const plugin = require('../index')(app)

    plugin.start({})

    app.emit('canboatjs:rawoutput', '2026-04-24T15:00:00.000Z 2 1CFF000B 30 99 01 F4 01 E8 03 55')

    assert.ok(app.lastMessage, 'no delta emitted from raw fallback')
    toFlat(app.lastMessage.delta).should.jsonEqual(expectedFlat)

    plugin.stop()
  })

  it('serializes state to actisense format', () => {
    const app = createApp()
    const plugin = require('../index')(app)
    const state = {
      dimmers: [500, 1000],
      lastDimmingLevels: [1000, 1000],
      switches: [1, 0, 1, 0, 1, 0, 1, 0]
    }

    const actisense = plugin.generateStatePGN(0, state)

    actisense.substr(25).should.equal('2,65280,0,255,8,30,99,00,f4,01,e8,03,55')
  })

  it('returns a clear error when PUT arrives before instance state is cached', () => {
    const app = createApp()
    const plugin = require('../index')(app)

    plugin.createDelta(plugin.readDataBuffer(Buffer.from([0x00, 0xf4, 0x01, 0xe8, 0x03, 0x55])))

    const handler = app.handlers.find(entry => entry.path === 'electrical.switches.empirbus.0.1.state')

    assert.ok(handler, 'no action handler registered')

    const result = handler.handler('vessels.self', handler.path, true)

    result.statusCode.should.equal(503)
    result.message.should.equal('No current state cached for EmpirBus instance 0. Wait for a PGN 65280 status update before sending PUT requests.')
  })

  it('applies configured display names and control types', () => {
    const app = createApp()
    const plugin = require('../index')(app)

    plugin.start({
      displayNames: {
        'electrical.switches.empirbus.0.1': 'Saloon Lights',
        'electrical.switches.empirbus.0.3': 'Bilge Pump'
      },
      controlTypes: {
        'electrical.switches.empirbus.0.1': 'LightBulb',
        'electrical.switches.empirbus.0.3': 'Pump'
      }
    })

    const delta = plugin.createDelta(plugin.readDataBuffer(Buffer.from([0x00, 0xf4, 0x01, 0xe8, 0x03, 0x55])))
    const flat = toFlat(delta)

    _.get(flat, 'electrical.switches.empirbus.0.1.type').should.equal('LightBulb')
    _.get(flat, 'electrical.switches.empirbus.0.1.state.meta.displayName').should.equal('Saloon Lights')
    _.get(flat, 'electrical.switches.empirbus.0.1.level.meta.displayName').should.equal('Saloon Lights brightness')
    _.get(flat, 'electrical.switches.empirbus.0.3.type').should.equal('Pump')
    _.get(flat, 'electrical.switches.empirbus.0.3.state.meta.displayName').should.equal('Bilge Pump')
  })

  it('omits ignored paths from emitted values and put handlers', () => {
    const app = createApp()
    const plugin = require('../index')(app)

    plugin.start({
      ignoredPaths: [
        'electrical.switches.empirbus.0.1',
        'electrical.switches.empirbus.0.3'
      ]
    })

    const delta = plugin.createDelta(plugin.readDataBuffer(Buffer.from([0x00, 0xf4, 0x01, 0xe8, 0x03, 0x55])))
    const flat = toFlat(delta)

    assert.strictEqual(_.get(flat, 'electrical.switches.empirbus.0.1'), undefined)
    assert.strictEqual(_.get(flat, 'electrical.switches.empirbus.0.3'), undefined)
    _.get(flat, 'electrical.switches.empirbus.0.2.type').should.equal('dimmer')
    _.get(flat, 'electrical.switches.empirbus.0.4.type').should.equal('switch')

    const handlerPaths = app.handlers.map(entry => entry.path)
    handlerPaths.should.not.include('electrical.switches.empirbus.0.1.state')
    handlerPaths.should.not.include('electrical.switches.empirbus.0.1.level')
    handlerPaths.should.not.include('electrical.switches.empirbus.0.3.state')
    handlerPaths.should.include('electrical.switches.empirbus.0.2.state')
    handlerPaths.should.include('electrical.switches.empirbus.0.4.state')
  })

  it('can suppress type paths while keeping state data', () => {
    const app = createApp()
    const plugin = require('../index')(app)

    plugin.start({
      general: {
        publishTypePaths: false
      },
      instances: [
        {
          transmitInstance: 1,
          mode: 'Data Model 2 - Expanded'
        }
      ]
    })

    const delta = plugin.createDelta(plugin.readDataBuffer(Buffer.from([0x00, 0xf4, 0x01, 0xe8, 0x03, 0x55])))
    const flat = toFlat(delta)

    getValue(delta, 'electrical.switches.empirbus.0.1.state').should.equal(true)
    assert.strictEqual(_.get(flat, 'electrical.switches.empirbus.0.1.type'), undefined)
    getValue(delta, 'electrical.switches.empirbus.0.3.state').should.equal(true)
    assert.strictEqual(_.get(flat, 'electrical.switches.empirbus.0.3.type'), undefined)
    getValue(delta, 'electrical.switches.empirbus.0.w1.b03.state').should.equal(true)
    assert.strictEqual(_.get(flat, 'electrical.switches.empirbus.0.w1.b03.type'), undefined)
  })

  it('supports the legacy flat publishTypePaths setting', () => {
    const app = createApp()
    const plugin = require('../index')(app)

    plugin.start({
      publishTypePaths: false
    })

    const delta = plugin.createDelta(plugin.readDataBuffer(Buffer.from([0x00, 0xf4, 0x01, 0xe8, 0x03, 0x55])))
    const flat = toFlat(delta)

    assert.strictEqual(_.get(flat, 'electrical.switches.empirbus.0.1.type'), undefined)
    assert.strictEqual(_.get(flat, 'electrical.switches.empirbus.0.3.type'), undefined)
  })

  it('publishes expanded word-bit channels when configured per instance', () => {
    const app = createApp()
    const plugin = require('../index')(app)

    plugin.start({
      instances: [
        {
          transmitInstance: 1,
          mode: 'Data Model 2 - Expanded'
        }
      ]
    })

    const delta = plugin.createDelta(plugin.readDataBuffer(Buffer.from([0x00, 0xf4, 0x01, 0xe8, 0x03, 0x55])))
    const flat = toFlat(delta)

    _.get(flat, 'electrical.switches.empirbus.0.1.type').should.equal('switch')
    _.get(flat, 'electrical.switches.empirbus.0.2.type').should.equal('switch')
    assert.strictEqual(_.get(flat, 'electrical.switches.empirbus.0.1.level'), undefined)
    assert.strictEqual(_.get(flat, 'electrical.switches.empirbus.0.2.level'), undefined)
    getValue(delta, 'electrical.switches.empirbus.0.w1.b03.state').should.equal(true)
    getValue(delta, 'electrical.switches.empirbus.0.w1.b09.state').should.equal(true)
    getValue(delta, 'electrical.switches.empirbus.0.w2.b04.state').should.equal(true)
    getValue(delta, 'electrical.switches.empirbus.0.w2.b10.state').should.equal(true)
    _.get(flat, 'electrical.switches.empirbus.0.w1.b01.type').should.equal('switch')
  })

  it('respects expanded channel settings for display, type, and publish suppression', () => {
    const app = createApp()
    const plugin = require('../index')(app)

    plugin.start({
      instances: [
        {
          transmitInstance: 1,
          mode: 'Data Model 2 - Expanded',
          channels: {
            'w1.b01': {
              kind: 'indicator',
              displayName: 'Gen Running'
            },
            'w1.b02': {
              enabled: false
            }
          }
        }
      ]
    })

    const delta = plugin.createDelta(plugin.readDataBuffer(Buffer.from([0x00, 0xf4, 0x01, 0xe8, 0x03, 0x55])))
    const flat = toFlat(delta)
    const handlerPaths = app.handlers.map(entry => entry.path)

    _.get(flat, 'electrical.switches.empirbus.0.w1.b01.type').should.equal('indicator')
    _.get(flat, 'electrical.switches.empirbus.0.w1.b01.state.meta.displayName').should.equal('Gen Running')
    assert.strictEqual(_.get(flat, 'electrical.switches.empirbus.0.w1.b02'), undefined)
    handlerPaths.should.not.include('electrical.switches.empirbus.0.w1.b01.state')
    handlerPaths.should.not.include('electrical.switches.empirbus.0.w1.b02.state')
    handlerPaths.should.include('electrical.switches.empirbus.0.w1.b03.state')
  })

  it('updates word values when expanded word-bit put handlers are used', () => {
    const app = createApp()
    const plugin = require('../index')(app)

    plugin.start({
      instances: [
        {
          transmitInstance: 1,
          mode: 'Data Model 2 - Expanded'
        }
      ]
    })

    plugin.listener({
      pgn: 65280,
      fields: {
        'Manufacturer Code': 'Empir Bus',
        Data: '01f401e80355'
      }
    })

    const handler = app.handlers.find(entry => entry.path === 'electrical.switches.empirbus.0.w1.b03.state')

    assert.ok(handler, 'no expanded word-bit action handler registered')

    const result = handler.handler('vessels.self', handler.path, false)

    result.statusCode.should.equal(200)
    app.sentPgns.should.have.length(1)
    app.sentPgns[0].substr(25).should.equal('2,65280,0,255,8,30,99,00,f0,01,e8,03,55')
  })

  it('supports legacy object-map instance configuration for compatibility', () => {
    const app = createApp()
    const plugin = require('../index')(app)

    plugin.start({
      instances: {
        0: {
          mode: 'Data Model 2 - Expanded'
        }
      }
    })

    const delta = plugin.createDelta(plugin.readDataBuffer(Buffer.from([0x00, 0xf4, 0x01, 0xe8, 0x03, 0x55])))

    getValue(delta, 'electrical.switches.empirbus.0.w1.b03.state').should.equal(true)
  })

  it('supports legacy array instance field for compatibility', () => {
    const app = createApp()
    const plugin = require('../index')(app)

    plugin.start({
      instances: [
        {
          instance: 0,
          mode: 'Data Model 2 - Expanded'
        }
      ]
    })

    const delta = plugin.createDelta(plugin.readDataBuffer(Buffer.from([0x00, 0xf4, 0x01, 0xe8, 0x03, 0x55])))

    getValue(delta, 'electrical.switches.empirbus.0.w1.b03.state').should.equal(true)
  })

})

const expectedFlat = {}

_.set(expectedFlat, 'electrical.switches.empirbus.0.1.state', true)
_.set(expectedFlat, 'electrical.switches.empirbus.0.1.level', 0.5)
_.set(expectedFlat, 'electrical.switches.empirbus.0.1.type', 'dimmer')
_.set(expectedFlat, 'electrical.switches.empirbus.0.2.state', false)
_.set(expectedFlat, 'electrical.switches.empirbus.0.2.level', 1)
_.set(expectedFlat, 'electrical.switches.empirbus.0.2.type', 'dimmer')
_.set(expectedFlat, 'electrical.switches.empirbus.0.3.state', true)
_.set(expectedFlat, 'electrical.switches.empirbus.0.3.type', 'switch')
_.set(expectedFlat, 'electrical.switches.empirbus.0.4.state', false)
_.set(expectedFlat, 'electrical.switches.empirbus.0.4.type', 'switch')
_.set(expectedFlat, 'electrical.switches.empirbus.0.5.state', true)
_.set(expectedFlat, 'electrical.switches.empirbus.0.5.type', 'switch')
_.set(expectedFlat, 'electrical.switches.empirbus.0.6.state', false)
_.set(expectedFlat, 'electrical.switches.empirbus.0.6.type', 'switch')
_.set(expectedFlat, 'electrical.switches.empirbus.0.7.state', true)
_.set(expectedFlat, 'electrical.switches.empirbus.0.7.type', 'switch')
_.set(expectedFlat, 'electrical.switches.empirbus.0.8.state', false)
_.set(expectedFlat, 'electrical.switches.empirbus.0.8.type', 'switch')

_.set(expectedFlat, 'electrical.switches.empirbus.0.1.state.meta', {
  units: 'bool',
  displayName: 'Dimmer 0.1',
  associatedDevice: { instance: 0, device: 'dimmer 1' }
})
_.set(expectedFlat, 'electrical.switches.empirbus.0.1.level.meta', {
  units: 'ratio',
  description: 'Dimmer brightness ratio, 0<=ratio<=1, 1 is 100%',
  displayName: 'Dimmer 0.1 brightness',
  associatedDevice: { instance: 0, device: 'dimmer 1' }
})
_.set(expectedFlat, 'electrical.switches.empirbus.0.2.state.meta', {
  units: 'bool',
  displayName: 'Dimmer 0.2',
  associatedDevice: { instance: 0, device: 'dimmer 2' }
})
_.set(expectedFlat, 'electrical.switches.empirbus.0.2.level.meta', {
  units: 'ratio',
  description: 'Dimmer brightness ratio, 0<=ratio<=1, 1 is 100%',
  displayName: 'Dimmer 0.2 brightness',
  associatedDevice: { instance: 0, device: 'dimmer 2' }
})
_.set(expectedFlat, 'electrical.switches.empirbus.0.3.state.meta', {
  units: 'bool',
  displayName: 'Switch 0.3',
  associatedDevice: { instance: 0, device: 'switch 3' }
})
_.set(expectedFlat, 'electrical.switches.empirbus.0.4.state.meta', {
  units: 'bool',
  displayName: 'Switch 0.4',
  associatedDevice: { instance: 0, device: 'switch 4' }
})
_.set(expectedFlat, 'electrical.switches.empirbus.0.5.state.meta', {
  units: 'bool',
  displayName: 'Switch 0.5',
  associatedDevice: { instance: 0, device: 'switch 5' }
})
_.set(expectedFlat, 'electrical.switches.empirbus.0.6.state.meta', {
  units: 'bool',
  displayName: 'Switch 0.6',
  associatedDevice: { instance: 0, device: 'switch 6' }
})
_.set(expectedFlat, 'electrical.switches.empirbus.0.7.state.meta', {
  units: 'bool',
  displayName: 'Switch 0.7',
  associatedDevice: { instance: 0, device: 'switch 7' }
})
_.set(expectedFlat, 'electrical.switches.empirbus.0.8.state.meta', {
  units: 'bool',
  displayName: 'Switch 0.8',
  associatedDevice: { instance: 0, device: 'switch 8' }
})

function toFlat(delta) {
  const res = {}

  delta.updates.forEach(update => {
    update.values.forEach(pathValue => {
      _.set(res, pathValue.path, pathValue.value)
    })

    ;(update.meta || []).forEach(pathValue => {
      _.set(res, `${pathValue.path}.meta`, pathValue.value)
    })
  })

  return res
}

function getValue(delta, path) {
  for (const update of delta.updates) {
    for (const pathValue of update.values) {
      if (pathValue.path === path) {
        return pathValue.value
      }
    }
  }
  return undefined
}
