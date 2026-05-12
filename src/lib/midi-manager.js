import MidiController from './midi-controller.js'
import LPD8 from './devices/lpd8.js'

class MidiManager {
  constructor ({ deviceClasses = [LPD8], initialKnobValue = 0.5, pickUpMode = true } = {}) {
    this._access = null
    this._preferredName = null
    this._registry = new Map()
    this._padProxies = new Array(16).fill(null)
    this._smoothState = new Array(16).fill(null)
    this._deviceClasses = deviceClasses
    this._deviceOptions = { initialKnobValue, pickUpMode }
    this._onStateChange = this._onStateChange.bind(this)
  }

  async init () {
    if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) {
      console.warn('[hydra-synth] Web MIDI not available')
      return
    }
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false })
      this._access = access
      console.log(`[hydra-synth] Web MIDI ready — ${access.inputs.size} input(s)`)
      access.inputs.forEach(input => {
        console.log(`[hydra-synth] MIDI input detected: "${input.name}"`)
        this._registerDevice(input)
      })
      access.onstatechange = this._onStateChange
    } catch (err) {
      console.warn('[hydra-synth] Web MIDI not available:', err)
    }
  }

  tick (dt) {
    const ctrl = this.controller
    if (ctrl) ctrl.tick(dt)

    for (let i = 0; i < this._smoothState.length; i++) {
      const state = this._smoothState[i]
      if (!state) continue
      const raw = ctrl ? (ctrl.knobs[i] ?? 0) : 0
      state.smoothed = state.smoothed * state.factor + raw * (1 - state.factor)
    }
  }

  knob (index, options) {
    const ctrl = this.controller
    if (options && options.smooth !== undefined) {
      if (!this._smoothState[index]) {
        const raw = ctrl ? (ctrl.knobs[index] ?? 0) : 0
        this._smoothState[index] = { smoothed: raw, factor: options.smooth }
      }
      return this._smoothState[index].smoothed
    }
    return ctrl ? (ctrl.knobs[index] ?? 0) : 0
  }

  pad (index) {
    if (!this._padProxies[index]) {
      this._padProxies[index] = this._createPadProxy(index)
    }
    return this._padProxies[index]
  }

  _createPadProxy (index) {
    const manager = this
    const callbacks = []
    return {
      get velocity () {
        const ctrl = manager.controller
        return ctrl ? (ctrl.pads[index]?.velocity ?? 0) : 0
      },
      get active () {
        const ctrl = manager.controller
        return ctrl ? (ctrl.pads[index]?.active ?? false) : false
      },
      onTrigger (fn) {
        callbacks.push(fn)
      },
      _callbacks: callbacks
    }
  }

  setController (nameSubstring) {
    this._preferredName = nameSubstring || null
  }

  get controller () {
    if (this._preferredName !== null) {
      const lower = this._preferredName.toLowerCase()
      for (const ctrl of this._registry.values()) {
        if (ctrl.name.toLowerCase().includes(lower)) return ctrl
      }
      return null
    }
    const first = this._registry.values().next()
    return first.done ? null : first.value
  }

  get controllers () {
    return Array.from(this._registry.values())
  }

  get devices () {
    if (!this._access) return []
    return Array.from(this._access.inputs.values())
  }

  _onStateChange (event) {
    if (event.port.type !== 'input') return
    if (event.port.state === 'connected') {
      this._registerDevice(event.port)
    } else if (event.port.state === 'disconnected') {
      this._deregisterDevice(event.port)
    }
  }

  _registerDevice (midiInput) {
    const cls = this._matchClass(midiInput)
    if (!cls) {
      console.log(`[hydra-synth] No driver matched for MIDI input: "${midiInput.name}"`)
      return
    }
    const instance = new cls(this._deviceOptions)
    instance.connect(midiInput)
    instance.on('pad:on', ({ index, velocity }) => {
      const proxy = this._padProxies[index]
      if (!proxy) return
      proxy._callbacks.forEach(fn => fn({ index, velocity }))
    })
    this._registry.set(midiInput.id, instance)
  }

  _deregisterDevice (midiInput) {
    const ctrl = this._registry.get(midiInput.id)
    if (!ctrl) return
    ctrl.disconnect()
    this._registry.delete(midiInput.id)
  }

  _matchClass (midiInput) {
    for (const cls of this._deviceClasses) {
      if (cls.deviceNamePattern.test(midiInput.name)) return cls
    }
    return null
  }
}

export default MidiManager
