'use strict'

const NOTE_LABELS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const COL_W  = 18
const CAN_H  = 80
const PANEL_W = 280

function init (el) {
  el.style.cssText = 'display:flex;flex-direction:row;align-items:flex-end;gap:2px;padding:3px 2px;box-sizing:border-box'

  const canvases = []
  const labels = []
  for (let i = 0; i < 12; i++) {
    const col = document.createElement('div')
    col.style.cssText = 'display:flex;flex-direction:column;align-items:center'

    const lbl = document.createElement('div')
    lbl.style.cssText = 'font:10px monospace;color:#0ff8;text-align:center;width:' + COL_W + 'px;padding-bottom:2px'
    lbl.textContent = NOTE_LABELS[i]
    col.appendChild(lbl)

    const cv = document.createElement('canvas')
    cv.width = COL_W
    cv.height = CAN_H
    cv.style.cssText = 'display:block;background:#111'
    cv._ctx = cv.getContext('2d')
    col.appendChild(cv)

    el.appendChild(col)
    canvases.push(cv)
    labels.push(lbl)
  }

  el._canvases = canvases
  el._labels = labels
}

function update (el) {
  if (!window.a || !el._canvases) return
  const chroma = window.a.chroma
  if (!Array.isArray(chroma) || chroma.length !== 12) return

  let domIdx = 0
  let domVal = -Infinity
  for (let i = 0; i < 12; i++) {
    if (chroma[i] > domVal) { domVal = chroma[i]; domIdx = i }
  }

  for (let i = 0; i < 12; i++) {
    const cv = el._canvases[i]
    const ctx = cv._ctx
    ctx.clearRect(0, 0, cv.width, cv.height)
    const v = Math.max(0, Math.min(1, chroma[i] || 0))
    const barH = v * cv.height
    ctx.fillStyle = i === domIdx ? '#0ff' : '#0ff8'
    ctx.fillRect(0, cv.height - barH, cv.width, barH)
    el._labels[i].style.color = i === domIdx ? '#0ff' : '#0ff8'
  }
}

module.exports = {
  id:     'chroma',
  title:  'Chromagram',
  key:    'k',
  zone:   'top-left',
  width:  PANEL_W,
  height: 140,
  init,
  update,
}
