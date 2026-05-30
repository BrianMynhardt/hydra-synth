'use strict'

const LABEL_W  = 30   // shared label column width
const BIN_W    = 52   // per-bin column width
const CANVAS_H = 80
const MAX_BINS = 12   // bins before horizontal scroll
const CUT_SENS = 0.1
const SCL_SENS = 0.15

const CAPTURE_MS = 3000
const PERIOD_MS  = 15000
const EPSILON    = 0.05
const HEADROOM   = 1.1
const FLASH_MS   = 600

const drag = { active: false, binIndex: 0, prop: '', startX: 0, startVal: 0, global: false }

function onDragMove (e) {
  if (!drag.active || !window.a) return
  const sens = drag.prop === 'cutoff' ? CUT_SENS : SCL_SENS
  const raw = drag.startVal + (e.clientX - drag.startX) * sens
  const newVal = drag.prop === 'cutoff'
    ? Math.max(0, Math.min(window.a.max || 15, raw))
    : Math.max(0.1, Math.min(50, raw))
  if (drag.global) {
    if (drag.prop === 'cutoff') window.a.setCutoff(newVal)
    else window.a.setScale(newVal)
  } else {
    window.a.settings[drag.binIndex][drag.prop] = newVal
  }
}

document.addEventListener('mousemove', onDragMove)
document.addEventListener('mouseup', () => { drag.active = false })

// Layout: one CSS-grid with 1 label column + N bin columns. Every row reuses
// the same grid-template-columns, so each bin cell across rows is identically
// sized and positioned — alignment is a property of the grid, not of per-cell
// styling.
function buildCols (el, count) {
  drag.active = false
  const grid = el._grid
  grid.innerHTML = ''

  const capped = Math.min(count, MAX_BINS)
  const totalW = LABEL_W + count * BIN_W
  const panelW = LABEL_W + capped * BIN_W + 18  // 16px contentEl padding + 2px border

  grid.style.cssText =
    `display:grid;` +
    `grid-template-columns:${LABEL_W}px repeat(${count}, ${BIN_W}px);` +
    `min-width:${totalW}px;` +
    `overflow-x:${count > MAX_BINS ? 'auto' : 'hidden'}`

  // outer panel is el.parentElement (el is the contentEl from PerformanceUI)
  if (el.parentElement) el.parentElement.style.width = panelW + 'px'

  const canvases = []
  const rows = Array.from({ length: count }, () => [null, null, null, null, null])

  const appendSpacer = () => grid.appendChild(document.createElement('div'))

  // ── canvas row ───────────────────────────────────────────────────
  appendSpacer()
  for (let i = 0; i < count; i++) {
    const cv = document.createElement('canvas')
    cv.width  = BIN_W
    cv.height = CANVAS_H
    cv.style.cssText = 'display:block;background:#111;cursor:pointer'
    cv.title = 'double-click to auto-tune this bin'
    cv.addEventListener('dblclick', () => {
      if (!window.a || !window.a.bins) return
      if (el._tune) return
      startCapture(el, [i])
    })
    canvases.push(cv)
    grid.appendChild(cv)
  }

  // ── bin-number row ───────────────────────────────────────────────
  appendSpacer()
  for (let i = 0; i < count; i++) {
    const num = document.createElement('div')
    num.style.cssText = 'font:bold 10px monospace;color:#0ff;text-align:right;padding:2px 4px 1px;box-sizing:border-box'
    num.textContent = i
    grid.appendChild(num)
  }

  // ── stat rows ────────────────────────────────────────────────────
  ;[
    { label: 'raw', color: '#ccc', prop: null     },
    { label: 'fft', color: '#888', prop: null     },
    { label: 'cut', color: '#ff0', prop: 'cutoff' },
    { label: 'scl', color: '#888', prop: 'scale'  },
    { label: 'hz',  color: '#888', prop: null     },
  ].forEach(({ label, color, prop }, si) => {
    const scrubable = prop !== null

    const lbl = document.createElement('div')
    lbl.style.cssText =
      `font:10px monospace;color:${scrubable ? '#aaa' : '#555'};` +
      `padding-left:2px;display:flex;align-items:center;user-select:none` +
      (scrubable ? ';cursor:ew-resize' : '')
    lbl.textContent = label
    if (scrubable) {
      lbl.addEventListener('mousedown', e => {
        if (!window.a) return
        drag.active   = true
        drag.binIndex = 0
        drag.prop     = prop
        drag.startX   = e.clientX
        drag.startVal = prop === 'cutoff' ? window.a.cutoff : window.a.scale
        drag.global   = true
        e.preventDefault()
      })
    }
    grid.appendChild(lbl)

    for (let i = 0; i < count; i++) {
      const cell = document.createElement('div')
      cell.style.cssText =
        `font:10px monospace;color:${color};text-align:right;padding:0 4px;box-sizing:border-box`
      cell.textContent = '—'
      if (scrubable) {
        cell.style.cursor = 'ew-resize'
        cell.addEventListener('mousedown', e => {
          if (!window.a) return
          drag.active   = true
          drag.binIndex = i
          drag.prop     = prop
          drag.startX   = e.clientX
          drag.startVal = window.a.settings[i][prop]
          drag.global   = false
          e.preventDefault()
        })
      }
      rows[i][si] = cell
      grid.appendChild(cell)
    }
  })

  el._rows     = rows
  el._canvases = canvases
  el._peaks    = Array(count).fill(0)
  el._peakAge  = Array(count).fill(0)
  el._binCount = count
}

function paintBtn (el, label) {
  const btn = el._tuneBtn
  if (!btn) return
  if (el._tuneMode) {
    btn.style.background = '#0ff'
    btn.style.color      = '#000'
  } else {
    btn.style.background = 'rgba(0,0,0,0.75)'
    btn.style.color      = '#0ff'
  }
  btn.textContent = label
}

function startCapture (el, targets) {
  if (!window.a || !window.a.bins) return
  if (el._tune) return
  const n = window.a.bins.length
  el._tune = {
    samples:  Array.from({ length: n }, () => []),
    until:    performance.now() + CAPTURE_MS,
    binCount: n,
    targets:  targets || Array.from({ length: n }, (_, i) => i),
  }
  paintBtn(el, 'listening…')
}

function init (el, titleBar) {
  el.style.cssText = 'display:flex;flex-direction:column;padding:3px 2px;box-sizing:border-box'

  const btn = document.createElement('button')
  btn.style.cssText = 'font:11px monospace;background:rgba(0,0,0,0.75);border:1px solid #0ff;color:#0ff;padding:1px 6px;cursor:pointer;margin-right:6px'
  btn.title = 'click to toggle periodic auto-tune (every 15s)'
  btn.addEventListener('click', () => {
    if (!window.a || !window.a.bins) return
    if (el._tuneMode) {
      el._tuneMode = false
      el._tune = null
      paintBtn(el, 'auto-tune')
    } else {
      el._tuneMode = true
      startCapture(el, null)
    }
  })
  if (titleBar && titleBar.lastChild) {
    titleBar.insertBefore(btn, titleBar.lastChild)
  }
  el._tuneBtn = btn
  paintBtn(el, 'auto-tune')

  const grid = document.createElement('div')
  grid.style.cssText = 'display:flex;flex-direction:column'
  el.appendChild(grid)
  el._grid = grid

  buildCols(el, 4)
}

function update (el) {
  if (!window.a || !el._rows) return
  const { bins, fft, settings } = window.a
  if (!bins || !fft || !settings) return

  if (el._tune) {
    if (bins.length !== el._tune.binCount) {
      el._tune = null
      paintBtn(el, 'auto-tune')
    } else {
      for (let i = 0; i < bins.length; i++) el._tune.samples[i].push(bins[i])
      if (performance.now() >= el._tune.until) {
        const results = el._tune.targets.map(i => {
          const sorted = el._tune.samples[i].slice().sort((a, b) => a - b)
          return {
            i,
            cutoff: sorted[Math.floor(sorted.length * 0.10)],
            peak:   sorted[Math.floor(sorted.length * 0.95)],
          }
        })
        const silent = results.some(r => r.peak - r.cutoff < EPSILON)
        if (silent) {
          el._tuneBtn.style.background = '#400'
          el._tuneBtn.style.color      = '#f88'
          el._tuneBtn.textContent      = 'silence'
          setTimeout(() => paintBtn(el, 'auto-tune'), FLASH_MS)
        } else {
          for (const r of results) {
            settings[r.i].cutoff = r.cutoff
            settings[r.i].scale  = (r.peak - r.cutoff) * HEADROOM
          }
          paintBtn(el, 'auto-tune')
        }
        el._tune = null
        if (el._tuneMode) el._tuneNext = performance.now() + (PERIOD_MS - CAPTURE_MS)
      }
    }
  }

  if (el._tuneMode && !el._tune && performance.now() >= (el._tuneNext || 0)) {
    startCapture(el, null)
  }

  if (bins.length !== el._binCount) buildCols(el, bins.length)

  const MAX = window.a.max || 15
  for (let i = 0; i < bins.length; i++) {
    const cells = el._rows[i]
    cells[0].textContent = bins[i].toFixed(2)
    cells[1].textContent = fft[i].toFixed(3)
    cells[2].textContent = settings[i].cutoff.toFixed(2)
    cells[3].textContent = settings[i].scale.toFixed(2)
    cells[4].textContent = settings[i].minHz != null
      ? settings[i].minHz + '–' + settings[i].maxHz
      : '—'

    const cv = el._canvases[i]
    if (!cv) continue
    const ctx = cv.getContext('2d')
    ctx.clearRect(0, 0, cv.width, cv.height)

    const barH = Math.min(cv.height, (bins[i] / MAX) * cv.height)
    ctx.fillStyle = '#0ff8'
    ctx.fillRect(0, cv.height - barH, cv.width, barH)

    const cutoffY = cv.height - (settings[i].cutoff / MAX) * cv.height
    ctx.strokeStyle = '#ff04'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, cutoffY)
    ctx.lineTo(cv.width, cutoffY)
    ctx.stroke()

    if (bins[i] > el._peaks[i]) {
      el._peaks[i] = bins[i]
      el._peakAge[i] = 0
    } else {
      el._peakAge[i]++
    }
    if (el._peakAge[i] > 90) el._peaks[i] *= 0.95

    const peakY = cv.height - Math.min(cv.height, (el._peaks[i] / MAX) * cv.height)
    ctx.strokeStyle = '#fff'
    ctx.beginPath()
    ctx.moveTo(0, peakY)
    ctx.lineTo(cv.width, peakY)
    ctx.stroke()
  }
}

module.exports = {
  id:     'audio',
  title:  'Audio Bins',
  key:    'a',
  zone:   'top-left',
  width:  LABEL_W + 4 * BIN_W + 18,  // default: 4 bins
  height: 175,
  init,
  update,
}
