'use strict'

const FLASH_MS = 600

function flashButton (btn) {
  if (!btn) return
  if (btn._flashTimer) clearTimeout(btn._flashTimer)
  btn.style.background = '#600'
  btn.style.color = '#fff'
  btn._flashTimer = setTimeout(function () {
    btn.style.background = ''
    btn.style.color = ''
    btn._flashTimer = null
  }, FLASH_MS)
}

function init (el) {
  const list = document.createElement('div')
  list.style.overflowY = 'auto'
  list.style.maxHeight = '240px'
  el._list = list
  el._lastLength = 0
  el.appendChild(list)
}

function update (el) {
  const list = window.evalErrors || []
  if (list.length === el._lastLength) return
  const isNew = list.length > (el._lastLength || 0)
  el._lastLength = list.length

  if (isNew && el.parentElement && el.parentElement.style.display === 'none') {
    const entry = window.performanceUI && window.performanceUI._panels &&
      window.performanceUI._panels.find(function (p) { return p.descriptor.id === 'eval-console' })
    if (entry && entry.btnEl) flashButton(entry.btnEl)
  }

  el._list.innerHTML = ''
  const entries = list.slice(-20).reverse()
  entries.forEach(function (entry) {
    const row = document.createElement('div')
    row.style.display = 'flex'
    row.style.alignItems = 'baseline'
    row.style.gap = '6px'
    row.style.padding = '3px 0'
    row.style.borderBottom = '1px solid #0ff2'
    row.title = entry.message

    const ts = document.createElement('span')
    ts.textContent = entry.ts.toLocaleTimeString()
    ts.style.fontSize = '11px'
    ts.style.color = '#0ff8'
    ts.style.whiteSpace = 'nowrap'

    const badge = document.createElement('span')
    if (entry.level === 'error') {
      badge.textContent = 'ERR'
      badge.style.background = '#600'
      badge.style.color = '#fff'
    } else {
      badge.textContent = 'WRN'
      badge.style.background = '#660'
      badge.style.color = '#fff'
    }
    badge.style.fontSize = '10px'
    badge.style.padding = '1px 4px'
    badge.style.borderRadius = '2px'
    badge.style.flexShrink = '0'

    const preview = document.createElement('span')
    preview.textContent = entry.message.slice(0, 200)
    preview.style.fontFamily = 'monospace'
    preview.style.fontSize = '11px'
    preview.style.overflow = 'hidden'
    preview.style.textOverflow = 'ellipsis'
    preview.style.whiteSpace = 'nowrap'
    preview.style.flex = '1'

    row.appendChild(ts)
    row.appendChild(badge)
    row.appendChild(preview)
    el._list.appendChild(row)
  })
}

module.exports = {
  id:     'eval-console',
  title:  'Eval Console',
  key:    'e',
  zone:   'bottom-right',
  width:  420,
  height: 280,
  init,
  update,
  flashButton,
}
