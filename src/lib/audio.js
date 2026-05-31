import Meyda from 'meyda'

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
      }
    }
    if (this.isDrawing) this.draw()
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
