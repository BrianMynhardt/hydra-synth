'use strict'

function init (el) {
  el._rows = []
  for (var i = 0; i < 10; i++) {
    ;(function (idx) {
      const row = document.createElement('div')
      row.style.display = 'flex'
      row.style.alignItems = 'center'
      row.style.gap = '6px'
      row.style.padding = '3px 0'
      row.style.borderBottom = '1px solid #0ff2'

      const num = document.createElement('span')
      num.textContent = idx
      num.style.width = '12px'
      num.style.textAlign = 'right'
      num.style.color = '#0ff8'
      num.style.fontSize = '11px'
      num.style.flexShrink = '0'

      const preview = document.createElement('span')
      preview.style.fontFamily = 'monospace'
      preview.style.fontSize = '11px'
      preview.style.overflow = 'hidden'
      preview.style.textOverflow = 'ellipsis'
      preview.style.whiteSpace = 'nowrap'
      preview.style.flex = '1'

      const saveBtn = document.createElement('button')
      saveBtn.textContent = 'save'
      saveBtn.style.fontSize = '10px'
      saveBtn.style.cursor = 'pointer'
      saveBtn.style.flexShrink = '0'
      saveBtn.addEventListener('click', function () {
        var code = window._devEditor ? window._devEditor.value : null
        window.snippetBank[idx] = code
        if (code != null) {
          localStorage.setItem('hydra-snippet-' + idx, code)
        } else {
          localStorage.removeItem('hydra-snippet-' + idx)
        }
        el._sig = null
      })

      const clearBtn = document.createElement('button')
      clearBtn.textContent = 'clear'
      clearBtn.style.fontSize = '10px'
      clearBtn.style.cursor = 'pointer'
      clearBtn.style.flexShrink = '0'
      clearBtn.addEventListener('click', function () {
        window.snippetBank[idx] = null
        localStorage.removeItem('hydra-snippet-' + idx)
        el._sig = null
      })

      row.appendChild(num)
      row.appendChild(preview)
      row.appendChild(saveBtn)
      row.appendChild(clearBtn)
      el.appendChild(row)
      el._rows.push({ preview: preview, saveBtn: saveBtn, clearBtn: clearBtn })
    })(i)
  }
}

function update (el) {
  if (!window.snippetBank) return
  var sig = window.snippetBank.map(function (s) { return s ? s.slice(0, 8) : '' }).join('|')
  if (sig === el._sig) return
  for (var i = 0; i < 10; i++) {
    var slot = window.snippetBank[i]
    var row = el._rows[i]
    if (!row) continue
    if (slot != null) {
      row.preview.textContent = slot.trim().slice(0, 30)
      row.preview.style.color = '#0ff'
    } else {
      row.preview.textContent = '(empty)'
      row.preview.style.color = '#0ff4'
    }
  }
  el._sig = sig
}

module.exports = {
  id:     'snippets',
  title:  'Snippets',
  key:    's',
  zone:   'top-right',
  width:  300,
  height: 240,
  init,
  update,
}
