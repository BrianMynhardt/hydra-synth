'use strict'

// z-order: strip 10000, editor 9999, panels 9998
const ZONE_ANCHORS = {
  'top-left':     { left: '8px',  right: null  },
  'top-right':    { left: null,   right: '8px' },
  'bottom-left':  { left: '8px',  right: null  },
  'bottom-right': { left: null,   right: '8px' },
}

// top-right zone starts below the button strip (~36px) to avoid overlap
const ZONE_INITIAL_OFFSETS = {
  'top-right': 36,
}

function computeTop (zone, offset) {
  if (zone.startsWith('top')) return `calc(8px + ${offset}px)`
  return null
}

function computeBottom (zone, offset) {
  if (zone.startsWith('bottom')) return `calc(30vh + 8px + ${offset}px)`
  return null
}

class PerformanceUI {
  constructor () {
    this._panels = []
    this._zoneOffsets = {}
    this._createStrip()
    document.addEventListener('keydown', this._routeKey.bind(this))
  }

  _createStrip () {
    const strip = document.createElement('div')
    Object.assign(strip.style, {
      position:   'fixed',
      top:        '8px',
      right:      '8px',
      zIndex:     '10000',
      display:    'flex',
      gap:        '4px',
      fontFamily: 'monospace',
    })
    document.body.appendChild(strip)
    this._stripEl = strip
  }

  _togglePanel (entry) {
    const visible = entry.outerEl.style.display !== 'none'
    entry.outerEl.style.display = visible ? 'none' : 'block'
    // dim button when hidden, highlight when visible
    const active = !visible
    entry.btnEl.style.color       = active ? '#0ff'  : '#0ff4'
    entry.btnEl.style.borderColor = active ? '#0ff'  : '#0ff4'
  }

  _routeKey (e) {
    if (!e.altKey || e.ctrlKey || e.metaKey) return
    const entry = this._panels.find(p => p.descriptor.key === e.key)
    if (!entry) return
    e.preventDefault()
    this._togglePanel(entry)
  }

  _createPanel (d) {
    const outer = document.createElement('div')
    Object.assign(outer.style, {
      position:   'fixed',
      background: 'rgba(0,0,0,0.75)',
      border:     '1px solid #0ff',
      color:      '#0ff',
      fontFamily: 'monospace',
      fontSize:   '12px',
      zIndex:     '9998',
      width:      d.width + 'px',
      display:    'none',
    })

    const titleBar = document.createElement('div')
    Object.assign(titleBar.style, {
      padding:        '4px 8px',
      borderBottom:   '1px solid #0ff4',
      display:        'flex',
      justifyContent: 'space-between',
      alignItems:     'center',
      cursor:         'default',
    })

    const titleText = document.createElement('span')
    titleText.textContent = `${d.title}  [Alt+${d.key}]`
    titleBar.appendChild(titleText)

    const closeBtn = document.createElement('span')
    closeBtn.textContent = '×'
    closeBtn.style.cursor = 'pointer'
    // click handler wired in register() via _togglePanel
    titleBar.appendChild(closeBtn)

    outer.appendChild(titleBar)

    const contentEl = document.createElement('div')
    contentEl.style.padding = '4px 8px'
    outer.appendChild(contentEl)

    d.init(contentEl)

    document.body.appendChild(outer)
    return { outerEl: outer, contentEl, closeBtn }
  }

  _mountZone (outerEl, zone) {
    const initial = ZONE_INITIAL_OFFSETS[zone] || 0
    const offset = (this._zoneOffsets[zone] || 0) + initial
    const anchors = ZONE_ANCHORS[zone] || ZONE_ANCHORS['top-left']

    if (anchors.left)  outerEl.style.left  = anchors.left
    if (anchors.right) outerEl.style.right = anchors.right

    const top    = computeTop(zone, offset)
    const bottom = computeBottom(zone, offset)
    if (top)    outerEl.style.top    = top
    if (bottom) outerEl.style.bottom = bottom

    const panelHeight = (outerEl._panelHeight || 0) + 8  // 8px gap
    this._zoneOffsets[zone] = (this._zoneOffsets[zone] || 0) + panelHeight
  }

  register (d) {
    const { outerEl, contentEl, closeBtn } = this._createPanel(d)
    outerEl._panelHeight = (d.height || 160) + 28  // 28px title bar

    const entry = { descriptor: d, outerEl, contentEl, btnEl: null }

    closeBtn.addEventListener('click', () => this._togglePanel(entry))

    const btn = document.createElement('button')
    Object.assign(btn.style, {
      background:  'rgba(0,0,0,0.75)',
      border:      '1px solid #0ff4',
      color:       '#0ff4',
      fontFamily:  'monospace',
      fontSize:    '11px',
      cursor:      'pointer',
      padding:     '2px 6px',
    })
    btn.textContent = d.title
    btn.addEventListener('click', () => this._togglePanel(entry))
    this._stripEl.appendChild(btn)
    entry.btnEl = btn

    this._mountZone(outerEl, d.zone || 'top-left')
    this._panels.push(entry)
  }

  tick () {
    for (let i = 0; i < this._panels.length; i++) {
      const { descriptor: d, outerEl, contentEl } = this._panels[i]
      if (outerEl.style.display !== 'none') {
        d.update(contentEl)
      }
    }
  }
}

module.exports = PerformanceUI
