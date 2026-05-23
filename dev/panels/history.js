'use strict'

function init (el) {
  const list = document.createElement('div')
  list.style.overflowY = 'auto'
  list.style.maxHeight = '240px'
  el._list = list
  el.appendChild(list)
}

function update (el) {
  if (!window.evalHistory || el._lastLength === window.evalHistory.length) return
  el._list.innerHTML = ''
  const entries = window.evalHistory.slice().reverse()
  entries.forEach(function (entry) {
    const row = document.createElement('div')
    row.style.display = 'flex'
    row.style.alignItems = 'baseline'
    row.style.gap = '6px'
    row.style.padding = '3px 0'
    row.style.borderBottom = '1px solid #0ff2'

    const ts = document.createElement('span')
    ts.textContent = entry.ts.toLocaleTimeString()
    ts.style.fontSize = '11px'
    ts.style.color = '#0ff8'
    ts.style.whiteSpace = 'nowrap'

    const preview = document.createElement('span')
    preview.textContent = entry.code.trim().slice(0, 80)
    preview.style.fontFamily = 'monospace'
    preview.style.fontSize = '11px'
    preview.style.overflow = 'hidden'
    preview.style.textOverflow = 'ellipsis'
    preview.style.whiteSpace = 'nowrap'
    preview.style.flex = '1'

    const btn = document.createElement('button')
    btn.textContent = 'restore'
    btn.style.fontSize = '10px'
    btn.style.cursor = 'pointer'
    btn.addEventListener('click', function () {
      if (window._devEditor) window._devEditor.value = entry.code
    })

    row.appendChild(ts)
    row.appendChild(preview)
    row.appendChild(btn)
    el._list.appendChild(row)
  })
  el._lastLength = window.evalHistory.length
}

module.exports = {
  id:     'history',
  title:  'Eval History',
  key:    'h',
  zone:   'top-right',
  width:  360,
  height: 280,
  init,
  update,
}
