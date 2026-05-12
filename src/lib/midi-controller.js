class MidiController {
  static get deviceNamePattern () { return /.*/ }

  constructor () {
    this.knobs = []
    this.pads = []
    this._midiInput = null
    this._listeners = {}
  }

  get name () {
    return this._midiInput?.name ?? ''
  }

  connect (midiInput) {
    this._midiInput = midiInput
    midiInput.onmidimessage = this.onMessage.bind(this)
  }

  disconnect () {
    if (this._midiInput) {
      this._midiInput.onmidimessage = null
    }
    this._midiInput = null
  }

  onMessage (event) {
    throw new TypeError('MidiController.onMessage must be implemented by subclass')
  }

  tick (dt) {}

  on (event, fn) {
    if (!this._listeners[event]) this._listeners[event] = []
    this._listeners[event].push(fn)
  }

  off (event, fn) {
    if (!this._listeners[event]) return
    this._listeners[event] = this._listeners[event].filter(f => f !== fn)
  }

  emit (event, data) {
    if (!this._listeners[event]) return
    this._listeners[event].forEach(fn => fn(data))
  }
}

export default MidiController
