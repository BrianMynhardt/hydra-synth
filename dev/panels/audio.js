'use strict'

const LABEL_W  = 30   // shared label column width
const BIN_W    = 52   // per-bin column width
const CANVAS_W = BIN_W
const CANVAS_H = 80
const MAX_BINS = 12   // bins before horizontal scroll
const CUT_SENS = 0.1
const SCL_SENS = 0.15

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

function makeRow (contentW) {
  const row = document.createElement('div')
  row.style.cssText = `display:flex;align-items:stretch;min-width:${contentW}px`
  return row
}

function makeLabelCell (text, color, cursor) {
  const cell = document.createElement('div')
  cell.style.cssText = `width:${LABEL_W}px;flex-shrink:0;font:10px monospace;color:${color};` +
    `display:flex;align-items:center;padding-left:2px;user-select:none` +
    (cursor ? `;cursor:${cursor}` : '')
  cell.textContent = text
  return cell
}

function makeBinCell (first) {
  const cell = document.createElement('div')
  cell.style.cssText = `width:${BIN_W}px;flex-shrink:0;display:flex;align-items:center;justify-content:center` +
    (first ? '' : ';border-left:1px solid #0ff2')
  return cell
}

function buildCols (el, count) {
  drag.active = false
  el.innerHTML = ''

  const capped    = Math.min(count, MAX_BINS)
  const contentW  = LABEL_W + count * BIN_W
  const panelW    = LABEL_W + capped * BIN_W + 18  // 16px contentEl padding + 2px border

  el.style.overflowX = count > MAX_BINS ? 'auto' : 'hidden'
  if (el.parentElement) el.parentElement.style.width = panelW + 'px'

  const rows     = []
  const canvases = []

  // ── canvas row ──────────────────────────────────────────────────
  const canvasRow = makeRow(contentW)
  canvasRow.style.marginBottom = '2px'
  canvasRow.appendChild(makeLabelCell('', '#555'))

  for (let i = 0; i < count; i++) {
    const cell = makeBinCell(i === 0)
    cell.style.alignItems = 'flex-end'
    const cv = document.createElement('canvas')
    cv.width  = CANVAS_W
    cv.height = CANVAS_H
    cv.style.cssText = 'display:block;background:#111'
    cell.appendChild(cv)
    canvases.push(cv)
    canvasRow.appendChild(cell)
  }
  el.appendChild(canvasRow)

  // ── bin-number row ───────────────────────────────────────────────
  const numRow = makeRow(contentW)
  numRow.appendChild(makeLabelCell('', '#555'))

  for (let i = 0; i < count; i++) {
    const cell = makeBinCell(i === 0)
    cell.style.font    = 'bold 10px monospace'
    cell.style.color   = '#0ff'
    cell.style.padding = '1px 0'
    cell.textContent   = i
    numRow.appendChild(cell)
  }
  el.appendChild(numRow)

  // ── stat rows ────────────────────────────────────────────────────
  for (let i = 0; i < count; i++) rows.push([null, null, null, null])

  ;[
    { label: 'raw', color: '#ccc', prop: null     },
    { label: 'fft', color: '#888', prop: null     },
    { label: 'cut', color: '#ff0', prop: 'cutoff' },
    { label: 'scl', color: '#888', prop: 'scale'  },
  ].forEach(({ label, color, prop }, si) => {
    const scrubable = prop !== null
    const statRow = makeRow(contentW)

    const lbl = makeLabelCell(label, scrubable ? '#aaa' : '#555', scrubable ? 'ew-resize' : null)
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
    statRow.appendChild(lbl)

    for (let i = 0; i < count; i++) {
      const cell = makeBinCell(i === 0)
      cell.style.justifyContent = 'flex-end'
      cell.style.padding        = '0 4px'
      cell.style.font           = '10px monospace'
      cell.style.color          = color
      cell.textContent          = '—'

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
      statRow.appendChild(cell)
    }
    el.appendChild(statRow)
  })

  el._rows     = rows
  el._canvases = canvases
  el._peaks    = Array(count).fill(0)
  el._peakAge  = Array(count).fill(0)
  el._binCount = count
}

function init (el) {
  el.style.cssText = 'display:flex;flex-direction:column;padding:3px 2px;box-sizing:border-box'
  buildCols(el, 4)
}

function update (el) {
  if (!window.a || !el._rows) return
  const { bins, fft, settings } = window.a
  if (!bins || !fft || !settings) return

  if (bins.length !== el._binCount) buildCols(el, bins.length)

  const MAX = window.a.max || 15
  for (let i = 0; i < bins.length; i++) {
    const cells = el._rows[i]
    cells[0].textContent = bins[i].toFixed(2)
    cells[1].textContent = fft[i].toFixed(3)
    cells[2].textContent = settings[i].cutoff.toFixed(2)
    cells[3].textContent = settings[i].scale.toFixed(2)

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
  height: 160,
  init,
  update,
}
