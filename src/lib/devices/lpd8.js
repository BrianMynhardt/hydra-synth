import MidiController from '../midi-controller.js'

class LPD8 extends MidiController {
  static get deviceNamePattern () { return /LPD8/i }

  static get PROGRAMS () {
    return {
      1: {
        notes: [36, 37, 38, 39, 40, 41, 42, 43],
        ccs: [9, 10, 11, 12, 13, 14, 15, 16],
        padChannel: 0,
        knobChannel: 0
      },
      2: {
        notes: [48, 49, 50, 51, 52, 53, 54, 55],
        ccs: [70, 71, 72, 73, 74, 75, 76, 77],
        padChannel: 9,
        knobChannel: 0
      },
      3: {
        notes: [36, 37, 38, 39, 40, 41, 42, 43],
        ccs: [78, 79, 80, 81, 82, 83, 84, 85],
        padChannel: 9,
        knobChannel: 0
      },
      4: {
        notes: [32, 33, 34, 35, 36, 37, 38, 39],
        ccs: [70, 71, 72, 73, 74, 75, 76, 77],
        padChannel: 9,
        knobChannel: 0
      }
    }
  }

  constructor ({ initialKnobValue = 0.5, pickUpMode = true } = {}) {
    super()
    this.pickUpMode = pickUpMode
    this.knobs = Array(8).fill(initialKnobValue)
    this._pickedUp = Array(8).fill(false)
    this._lastHardwareValue = Array(8).fill(null)
    this.pads = Array(8).fill(null).map(() => ({
      active: false,
      velocity: 0,
      note: 0,
      _callbacks: []
    }))
    this.program = 1
  }

  setProgram (p) {
    if (p >= 1 && p <= 4) {
      this.program = p
      if (this.pickUpMode) {
        this._pickedUp.fill(false)
        this._lastHardwareValue.fill(null)
      }
    }
  }

  onMessage (event) {
    const status = event.data[0]
    const type = status & 0xF0
    const channel = status & 0x0F

    if (this.debug) {
      const typeNames = { 0x80: 'NoteOff', 0x90: 'NoteOn', 0xB0: 'CC' }
      console.log(`[LPD8] ${typeNames[type] || '0x' + type.toString(16)} ch=${channel} d1=${event.data[1]} d2=${event.data[2]}`)
    }

    if (type === 0x90 && event.data[2] > 0) {
      this._handleNoteOn(channel, event.data[1], event.data[2])
    } else if (type === 0x80 || (type === 0x90 && event.data[2] === 0)) {
      this._handleNoteOff(channel, event.data[1])
    } else if (type === 0xB0) {
      this._handleCC(channel, event.data[1], event.data[2])
    }
  }

  _handleNoteOn (channel, note, velocity) {
    const i = this._padIndexForNote(note)
    if (i === -1) return
    this.pads[i].active = true
    this.pads[i].velocity = velocity / 127
    this.pads[i].note = note
    this.emit('pad:on', { index: i, velocity: velocity / 127, note })
  }

  _handleNoteOff (channel, note) {
    const i = this._padIndexForNote(note)
    if (i === -1) return
    this.pads[i].active = false
    this.pads[i].velocity = 0
    this.emit('pad:off', { index: i, note })
  }

  _handleCC (channel, cc, value) {
    const i = this._knobIndexForCC(cc)
    if (i === -1) return
    const incoming = value / 127

    if (this.pickUpMode && !this._pickedUp[i]) {
      const prev = this._lastHardwareValue[i]
      const sw = this.knobs[i]
      if (prev === null) {
        if (Math.abs(incoming - sw) < 2 / 127) this._pickedUp[i] = true
      } else if ((prev <= sw && sw <= incoming) || (incoming <= sw && sw <= prev)) {
        this._pickedUp[i] = true
      }
      this._lastHardwareValue[i] = incoming
      if (!this._pickedUp[i]) return
    }

    this.knobs[i] = incoming
  }

  _padIndexForNote (note) {
    return LPD8.PROGRAMS[this.program].notes.indexOf(note)
  }

  _knobIndexForCC (cc) {
    return LPD8.PROGRAMS[this.program].ccs.indexOf(cc)
  }
}

export default LPD8
