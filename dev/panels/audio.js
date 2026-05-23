'use strict'

// Default bin count matches Audio.setBins default (4)
const DEFAULT_BIN_COUNT = 4

function init (el) {
  const table = document.createElement('table')
  table.style.borderCollapse = 'collapse'
  table.style.width = '100%'

  const thead = document.createElement('thead')
  const headerRow = document.createElement('tr')
  ;['Bin', 'raw', 'fft', 'cutoff', 'scale'].forEach(label => {
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
    tbody.appendChild(tr)
    rows.push(cells)
  }
  table.appendChild(tbody)
  el.appendChild(table)

  // Store rows on the element for update()
  el._rows = rows
}

function update (el) {
  if (!window.a || !el._rows) return
  const { bins, fft, settings } = window.a
  if (!bins || !fft || !settings) return

  const len = Math.min(bins.length, el._rows.length)
  for (let i = 0; i < len; i++) {
    const cells = el._rows[i]
    cells[0].textContent = i
    cells[1].textContent = bins[i].toFixed(2)
    cells[2].textContent = fft[i].toFixed(3)
    cells[3].textContent = settings[i].cutoff
    cells[4].textContent = settings[i].scale
  }
}

module.exports = {
  id:     'audio',
  title:  'Audio Bins',
  key:    'a',
  zone:   'top-left',
  width:  300,
  height: 160,
  init,
  update,
}
