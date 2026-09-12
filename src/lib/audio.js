import Meyda from 'meyda'

// autocorrelation tempo tracker (bpmAuto) tuning constants
const ENV_LEN     = 360  // flux-envelope ring buffer length (~6s of frames at 60fps)
const TEMPO_EVERY = 15   // frames between autocorrelation passes
const MIN_SAMPLES = 120  // filled envelope samples required before estimating
const BPM_MIN     = 70   // bpmAuto lower clamp
const BPM_MAX     = 220  // bpmAuto upper clamp — headroom for fast psytrance

class Audio {
  constructor ({
    numBins = 4,
    cutoff = 2,
    smooth = 0.4,
    max = 15,
    scale = 10,
    fftSize = 1024,
    beatThreshold = 40,
    beatHoldFrames = 20,
    autoMic = false,
    makeGlobal = true,
    isDrawing = false,
    parentEl = document.body
  } = {}) {
    this.vol = 0
    this.scale = scale
    this.max = max
    this.cutoff = cutoff
    this.smooth = smooth
    this.brightness = 0
    this.brightnessRaw = 0
    this.brightnessSmooth = 0.5
    this.chroma = new Array(12).fill(0)
    this.chromaSmooth = 0.4
    this.isBeat = false
    this.bpm = 0
    this.bpmSmooth = 0.6
    this.bpmConfidence = 0 // 0–1; high when inter-beat intervals are consistent
    this.beatPhase = 0 // sawtooth 0→1 between beats; see tick()
    this._beatTimes = []
    this._lastBeatTime = 0
    this._phaseAnchor = 0 // last onset time beatPhase was re-synced to
    this._phaseClock = 0  // performance.now() of the last beatPhase advance
    // autocorrelation tempo tracker — parallel to detectBeat, see _estimateTempo()
    this.bpmAuto = 0
    this.bpmAutoConfidence = 0 // 0–1; normalized peak autocorrelation
    this._env = new Float32Array(ENV_LEN) // rolling flux-sum envelope (onset function)
    this._envIdx = 0
    this._envCount = 0
    this._envDt = 16.7 // EMA of frame interval (ms) → lag↔BPM conversion
    this._envLastT = 0
    this._tempoCounter = 0
    this._fftSize = fftSize
    this._makeGlobal = makeGlobal
    this._context = null
    this._meyda = null
    this._sourceNode = null
    this._stream = null

    this.setBins(numBins)

    // beat detection from: https://github.com/therewasaguy/p5-music-viz/blob/gh-pages/demos/01d_beat_detect_amplitude/sketch.js
    this.beat = {
      holdFrames: beatHoldFrames,
      threshold: beatThreshold,
      _cutoff: 0,
      decay: 0.98,
      _framesSinceBeat: 0
    }

    this.onsetHoldFrames = 3
    this._prevSpectrum = null

    this.onBeat = () => {}

    this.canvas = document.createElement('canvas')
    this.canvas.width = 100
    this.canvas.height = 80
    this.canvas.style.width = "100px"
    this.canvas.style.height = "80px"
    this.canvas.style.position = 'absolute'
    this.canvas.style.right = '0px'
    this.canvas.style.bottom = '0px'
    parentEl.appendChild(this.canvas)

    this.isDrawing = isDrawing
    this.ctx = this.canvas.getContext('2d')
    this.ctx.fillStyle = "#DFFFFF"
    this.ctx.strokeStyle = "#0ff"
    this.ctx.lineWidth = 0.5

    if (autoMic) this.initMic()
  }

  initMic () {
    if (!window.navigator.mediaDevices) {
      return Promise.reject(new Error('mediaDevices not available'))
    }
    return window.navigator.mediaDevices.getUserMedia({ video: false, audio: true })
      .then(stream => this._connectSource(stream))
      .catch(err => console.error('[hydra audio] getUserMedia failed:', err))
  }

  initStream () {
    if (!window.navigator.mediaDevices) {
      return Promise.reject(new Error('mediaDevices not available'))
    }
    return window.navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
      .then(stream => {
        stream.getVideoTracks().forEach(t => t.stop())
        return this._connectSource(stream)
      })
      .catch(err => console.error('[hydra audio] getDisplayMedia failed:', err))
  }

  initMedia (el) {
    if (!el) return Promise.reject(new Error('element required'))
    el.crossOrigin = 'anonymous'
    if (!this._context) this._context = new AudioContext()
    const node = this._context.createMediaElementSource(el)
    this._connectSource(node)
    return this._context.resume()
  }

  _connectSource (streamOrNode) {
    if (!this._context) this._context = new AudioContext()
    this._context.resume()

    if (this._stream) {
      this._stream.getTracks().forEach(t => t.stop())
      this._stream = null
    }
    if (this._sourceNode) {
      try { this._sourceNode.disconnect() } catch (e) {}
      this._sourceNode = null
    }

    let sourceNode
    if (streamOrNode instanceof MediaStream) {
      this._stream = streamOrNode
      sourceNode = this._context.createMediaStreamSource(streamOrNode)
    } else {
      sourceNode = streamOrNode
    }
    this._sourceNode = sourceNode

    if (this._meyda) {
      this._meyda.stop()
      this._meyda.setSource(sourceNode)
      this._meyda.start()
    } else {
      this._meyda = Meyda.createMeydaAnalyzer({
        audioContext: this._context,
        source: sourceNode,
        bufferSize: this._fftSize,
        featureExtractors: ['loudness', 'amplitudeSpectrum', 'spectralCentroid', 'chroma']
      })
      this._meyda.start()
    }
  }

  start () {
    if (this._context) return this._context.resume()
    return Promise.resolve()
  }

  setFftSize (n) {
    this._fftSize = n
    if (this._meyda && this._sourceNode) {
      this._meyda.stop()
      this._meyda = Meyda.createMeydaAnalyzer({
        audioContext: this._context,
        source: this._sourceNode,
        bufferSize: n,
        featureExtractors: ['loudness', 'amplitudeSpectrum', 'spectralCentroid', 'chroma']
      })
    }
    this._prevSpectrum = null
  }

  detectBeat (level) {
    if (level > this.beat._cutoff && level > this.beat.threshold) {
      this.isBeat = true
      this.onBeat()
      this.beat._cutoff = level * 1.2
      this.beat._framesSinceBeat = 0
      const now = performance.now()
      if (this._lastBeatTime) {
        this._beatTimes.push(now - this._lastBeatTime)
        if (this._beatTimes.length > 8) this._beatTimes.shift()
      }
      this._lastBeatTime = now
      if (this._beatTimes.length >= 3) {
        const sorted = this._beatTimes.slice().sort((a, b) => a - b)
        const mid = Math.floor(sorted.length / 2)
        const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
        const raw = Math.max(70, Math.min(180, 60000 / median))
        // confidence from interval consistency: low coefficient of variation → high confidence
        const cvMax = 0.5 // cv at/above which confidence is 0 (tuning constant)
        const mean = this._beatTimes.reduce((a, b) => a + b, 0) / this._beatTimes.length
        const variance = this._beatTimes.reduce((a, b) => a + (b - mean) * (b - mean), 0) / this._beatTimes.length
        const cv = mean > 0 ? Math.sqrt(variance) / mean : 1
        this.bpmConfidence = Math.max(0, Math.min(1, 1 - cv / cvMax))
        // adaptive lock: low confidence retains the prior bpm, high confidence tracks at bpmSmooth
        const wOld = 1 - this.bpmConfidence * (1 - this.bpmSmooth)
        this.bpm = this.bpm === 0 ? raw : raw * (1 - wOld) + this.bpm * wOld
      }
    } else {
      if (this.beat._framesSinceBeat <= this.beat.holdFrames) {
        this.beat._framesSinceBeat++
      } else {
        this.beat._cutoff *= this.beat.decay
        this.beat._cutoff = Math.max(this.beat._cutoff, this.beat.threshold)
      }
    }
  }

  tick () {
    this.isBeat = false
    if (this._meyda) {
      var features = this._meyda.get()
      if (features && features !== null) {
        this.vol = features.loudness.total
        this.detectBeat(this.vol)
        const reducer = (accumulator, currentValue) => accumulator + currentValue
        let spacing = Math.floor(features.loudness.specific.length / this.bins.length)
        this.prevBins = this.bins.slice(0)
        this.bins = this.bins.map((bin, index) => {
          const s = this.settings[index]
          if (s.minHz != null && features.amplitudeSpectrum && this._context) {
            const spec = features.amplitudeSpectrum
            const binHz = this._context.sampleRate / this._fftSize
            const kMin = Math.max(0, Math.floor(s.minHz / binHz))
            const kMax = Math.min(spec.length - 1, Math.ceil(s.maxHz / binHz))
            let sum = 0
            for (let k = kMin; k <= kMax; k++) sum += spec[k]
            return sum
          }
          return features.loudness.specific.slice(index * spacing, (index + 1) * spacing).reduce(reducer)
        }).map((bin, index) => {
          return (bin * (1.0 - this.settings[index].smooth) + this.prevBins[index] * this.settings[index].smooth)
        })
        this.fft = this.bins.map((bin, index) => (
          Math.max(0, (bin - this.settings[index].cutoff) / this.settings[index].scale)
        ))
        const chroma = features.chroma
        if (Array.isArray(chroma) && chroma.length === 12) {
          const s = this.chromaSmooth
          for (let i = 0; i < 12; i++) {
            const v = Number.isFinite(chroma[i]) ? Math.max(0, Math.min(1, chroma[i])) : 0
            this.chroma[i] = v * (1 - s) + this.chroma[i] * s
          }
        }
        // spectral centroid → 0..1 "brightness" — see docs/IDEAS.md #9
        const sc = features.spectralCentroid
        if (Number.isFinite(sc) && this._context) {
          const hz       = sc * this._context.sampleRate / this._fftSize
          const nyquist  = this._context.sampleRate / 2
          const normRaw  = Math.max(0, Math.min(1, hz / nyquist))
          this.brightnessRaw = hz
          this.brightness    = normRaw * (1 - this.brightnessSmooth) +
                               this.brightness * this.brightnessSmooth
        }
        const spec = features.amplitudeSpectrum
        if (spec && this._context) {
          if (!this._prevSpectrum || this._prevSpectrum.length !== spec.length) {
            this._prevSpectrum = new Float32Array(spec.length)
          }
          const binHz = this._context.sampleRate / this._fftSize
          const span = spec.length / this.bins.length
          for (let i = 0; i < this.bins.length; i++) {
            const s = this.settings[i]
            let kMin, kMax
            if (s.minHz != null) {
              kMin = Math.max(0, Math.floor(s.minHz / binHz))
              kMax = Math.min(spec.length - 1, Math.ceil(s.maxHz / binHz))
            } else {
              kMin = Math.floor(i * span)
              kMax = Math.min(spec.length - 1, Math.floor((i + 1) * span) - 1)
            }
            let flux = 0
            for (let k = kMin; k <= kMax; k++) {
              const d = spec[k] - this._prevSpectrum[k]
              if (d > 0) flux += d
            }
            this.flux[i] = flux
            if (this._onsetCooldown[i] > 0) {
              this._onsetCooldown[i]--
              this.onset[i] = false
            } else if (flux >= s.fluxThreshold) {
              this.onset[i] = true
              this._onsetCooldown[i] = this.onsetHoldFrames
            } else {
              this.onset[i] = false
            }
          }
          this._prevSpectrum.set(spec)
        }
        // autocorrelation tempo: feed the broadband flux sum into a rolling
        // envelope and periodically estimate its dominant period.
        let fluxSum = 0
        for (let i = 0; i < this.flux.length; i++) fluxSum += this.flux[i]
        const envNow = performance.now()
        if (this._envLastT) {
          // clamp dt so a tab-blur / GC pause doesn't poison the rate estimate
          const dt = Math.max(4, Math.min(100, envNow - this._envLastT))
          this._envDt = this._envDt * 0.9 + dt * 0.1
        }
        this._envLastT = envNow
        this._env[this._envIdx] = fluxSum
        this._envIdx = (this._envIdx + 1) % ENV_LEN
        if (this._envCount < ENV_LEN) this._envCount++
        if ((++this._tempoCounter % TEMPO_EVERY) === 0 && this._envCount >= MIN_SAMPLES) {
          this._estimateTempo()
        }
      }
    }
    // beat phase: a free-running 0→1 sawtooth at the detected tempo. Prefers the
    // autocorrelation estimate (bpmAuto), which tracks fast tempos the amplitude
    // detector can't, and re-anchors to 0 on each detected onset so it stays
    // beat-aligned even when detectBeat only fires every other beat.
    const tempoBpm = this.bpmAuto > 0 ? this.bpmAuto : this.bpm
    if (tempoBpm > 0) {
      const nowMs = performance.now()
      if (this._lastBeatTime !== this._phaseAnchor) {
        this._phaseAnchor = this._lastBeatTime   // new onset → snap phase to the beat
        this.beatPhase = 0
      } else if (this._phaseClock) {
        this.beatPhase = (this.beatPhase + (nowMs - this._phaseClock) / (60000 / tempoBpm)) % 1
      }
      this._phaseClock = nowMs
    }
    if (this.isDrawing) this.draw()
  }

  // Estimate the dominant beat period from the flux envelope via normalized
  // autocorrelation. Runs independently of detectBeat(); writes bpmAuto /
  // bpmAutoConfidence and never touches this.bpm or beatPhase.
  _estimateTempo () {
    const n = Math.min(this._envCount, ENV_LEN)
    // copy the ring buffer into chronological order (oldest → newest)
    const start = this._envCount < ENV_LEN ? 0 : this._envIdx
    const buf = new Float32Array(n)
    for (let i = 0; i < n; i++) buf[i] = this._env[(start + i) % ENV_LEN]

    // DC removal: subtract the mean so autocorrelation reflects periodicity,
    // not the envelope's overall loudness level.
    let mean = 0
    for (let i = 0; i < n; i++) mean += buf[i]
    mean /= n
    for (let i = 0; i < n; i++) buf[i] -= mean

    // zero-lag energy normalizer; bail out on a silent / flat window
    let energy = 0
    for (let i = 0; i < n; i++) energy += buf[i] * buf[i]
    if (energy <= 1e-6) { this.bpmAutoConfidence = 0; return }

    // lag bounds from the measured sample interval (fast tempo → short lag)
    let lagMin = Math.max(1, Math.round(60000 / (BPM_MAX * this._envDt)))
    let lagMax = Math.min(n - 1, Math.round(60000 / (BPM_MIN * this._envDt)))
    if (lagMax <= lagMin) return

    // normalized autocorrelation; track the peak lag
    const score = new Float32Array(lagMax + 1)
    let bestLag = lagMin
    let bestScore = -Infinity
    for (let lag = lagMin; lag <= lagMax; lag++) {
      let ac = 0
      for (let i = lag; i < n; i++) ac += buf[i] * buf[i - lag]
      const s = ac / energy
      score[lag] = s
      if (s > bestScore) { bestScore = s; bestLag = lag }
    }

    // octave guard: when the best lag is short (fast tempo) and double that lag
    // scores comparably, prefer the slower period to avoid double-tempo errors.
    const dbl = bestLag * 2
    if (dbl <= lagMax && score[dbl] >= bestScore * 0.85) {
      bestLag = dbl
      bestScore = score[dbl]
    }

    const bpm = 60000 / (bestLag * this._envDt)
    this.bpmAuto = Math.max(BPM_MIN, Math.min(BPM_MAX, bpm))
    this.bpmAutoConfidence = Math.max(0, Math.min(1, bestScore))
  }

  setCutoff (cutoff) {
    this.cutoff = cutoff
    this.settings = this.settings.map((el) => {
      el.cutoff = cutoff
      return el
    })
  }

  setSmooth (smooth) {
    this.smooth = smooth
    this.settings = this.settings.map((el) => {
      el.smooth = smooth
      return el
    })
  }

  setBins (numBins) {
    this.bins = Array(numBins).fill(0)
    this.prevBins = Array(numBins).fill(0)
    this.fft = Array(numBins).fill(0)
    this.flux = Array(numBins).fill(0)
    this.onset = Array(numBins).fill(false)
    this._onsetCooldown = Array(numBins).fill(0)
    this.settings = Array(numBins).fill(0).map(() => ({
      cutoff: this.cutoff,
      scale: this.scale,
      smooth: this.smooth,
      minHz: null,
      maxHz: null,
      fluxThreshold: 0.1
    }))
    if (this._makeGlobal) {
      this.bins.forEach((bin, index) => {
        window['a' + index] = (scale = 1, offset = 0) => () => (this.fft[index] * scale + offset)
      })
      if (!window.br) {
        window.br = (scale = 1, offset = 0) => () => (this.brightness * scale + offset)
      }
      // audio-detected tempo — NOTE: distinct from the numeric `bpm` sequencing global
      if (!window.tempo) {
        window.tempo = (scale = 1, offset = 0) => () => (this.bpm * scale + offset)
      }
      if (!window.bp) {
        window.bp = (scale = 1, offset = 0) => () => (this.beatPhase * scale + offset)
      }
      if (!window.conf) {
        window.conf = (scale = 1, offset = 0) => () => (this.bpmConfidence * scale + offset)
      }
      // autocorrelation tempo tracker (parallel estimate to window.tempo)
      if (!window.tempoAuto) {
        window.tempoAuto = (scale = 1, offset = 0) => () => (this.bpmAuto * scale + offset)
      }
      if (!window.confAuto) {
        window.confAuto = (scale = 1, offset = 0) => () => (this.bpmAutoConfidence * scale + offset)
      }
      if (!window.ch0) {
        for (let i = 0; i < 12; i++) {
          window['ch' + i] = (scale = 1, offset = 0) => () => (this.chroma[i] * scale + offset)
        }
      }
    }
  }

  setBinRange (index, minHz, maxHz) {
    if (!Number.isInteger(index) || index < 0 || index >= this.settings.length) {
      throw new RangeError(`bin index ${index} out of range [0, ${this.settings.length})`)
    }
    if (minHz === null && maxHz === null) {
      this.settings[index].minHz = null
      this.settings[index].maxHz = null
      return
    }
    if (!Number.isFinite(minHz) || !Number.isFinite(maxHz) || minHz >= maxHz) {
      throw new TypeError(`invalid Hz range: ${minHz}..${maxHz}`)
    }
    this.settings[index].minHz = minHz
    this.settings[index].maxHz = maxHz
  }

  setOnsetThreshold (index, value) {
    if (!Number.isInteger(index) || index < 0 || index >= this.settings.length) {
      throw new RangeError(`bin index ${index} out of range`)
    }
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError(`fluxThreshold must be a non-negative number`)
    }
    this.settings[index].fluxThreshold = value
  }

  setScale (scale) {
    this.scale = scale
    this.settings = this.settings.map((el) => {
      el.scale = scale
      return el
    })
  }

  setMax (max) {
    this.max = max
    console.log('set max is deprecated')
  }

  hide () {
    this.isDrawing = false
    this.canvas.style.display = 'none'
  }

  show () {
    this.isDrawing = true
    this.canvas.style.display = 'block'
  }

  draw () {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    var spacing = this.canvas.width / this.bins.length
    var scale = this.canvas.height / (this.max * 2)
    this.bins.forEach((bin, index) => {
      var height = bin * scale
      this.ctx.fillRect(index * spacing, this.canvas.height - height, spacing, height)
      var y = this.canvas.height - scale * this.settings[index].cutoff
      this.ctx.beginPath()
      this.ctx.moveTo(index * spacing, y)
      this.ctx.lineTo((index + 1) * spacing, y)
      this.ctx.stroke()
      var yMax = this.canvas.height - scale * (this.settings[index].scale + this.settings[index].cutoff)
      this.ctx.beginPath()
      this.ctx.moveTo(index * spacing, yMax)
      this.ctx.lineTo((index + 1) * spacing, yMax)
      this.ctx.stroke()
    })
  }
}

export default Audio
