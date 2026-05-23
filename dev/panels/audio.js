'use strict'

// Default bin count matches Audio.setBins default (4)
const DEFAULT_BIN_COUNT = 4

function init (el) {
  const table = document.createElement('table')
  table.style.borderCollapse = 'collapse'
  table.style.width = '100%'

  const thead = document.createElement('thead')
  const headerRow = document.createElement('tr')
  ;['Bin', 'raw', 'fft', 'cutoff', 'scale', 'bar'].forEach(label => {
    const th = document.createElement('th')
    th.textContent = label
    th.style.textAlign = 'right'
    th.style.padding = '2px 6px'
    th.style.borderBottom = '1px solid #0ff4'
    headerRow.appendChild(th)
  })
  thead.appendChild(headerRow)
  table.appendChild(thead)

  const tbody = document.createElement('tbody')
  const rows = []
  const canvases = []
  for (let i = 0; i < DEFAULT_BIN_COUNT; i++) {
    const tr = document.createElement('tr')
    const cells = []
    for (let j = 0; j < 5; j++) {
      const td = document.createElement('td')
      td.textContent = '—'
      td.style.textAlign = 'right'
      td.style.padding = '2px 6px'
      tr.appendChild(td)
      cells.push(td)
    }
    const cvTd = document.createElement('td')
    cvTd.style.padding = '2px 6px'
    const cv = document.createElement('canvas')
    cv.width = 80
    cv.height = 14
    cvTd.appendChild(cv)
    tr.appendChild(cvTd)
    canvases.push(cv)
    tbody.appendChild(tr)
    rows.push(cells)
  }
  table.appendChild(tbody)
  el.appendChild(table)

  el._rows = rows
  el._canvases = canvases
  el._peaks = Array(DEFAULT_BIN_COUNT).fill(0)
  el._peakAge = Array(DEFAULT_BIN_COUNT).fill(0)
}

function update (el) {
  if (!window.a || !el._rows) return
  const { bins, fft, settings } = window.a
  if (!bins || !fft || !settings) return

  const MAX = window.a.max || 15
  const len = Math.min(bins.length, el._rows.length)
  for (let i = 0; i < len; i++) {
    const cells = el._rows[i]
    cells[0].textContent = i
    cells[1].textContent = bins[i].toFixed(2)
    cells[2].textContent = fft[i].toFixed(3)
    cells[3].textContent = settings[i].cutoff
    cells[4].textContent = settings[i].scale

    const cv = el._canvases && el._canvases[i]
    if (!cv) continue
    const ctx = cv.getContext('2d')

    const barH = Math.min(cv.height, (bins[i] / MAX) * cv.height)
    ctx.clearRect(0, 0, cv.width, cv.height)
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
    if (el._peakAge[i] > 90) { el._peaks[i] *= 0.95 }

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
  width:  400,
  height: 160,
  init,
  update,
}
