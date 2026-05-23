
const Hydra = require('./../')
// import Hydra from './../src/index.js'
const loop = require('raf-loop')
const { fugitiveGeometry, exampleVideo, exampleResize, nonGlobalCanvas, midiDemo, audioDemo } = require('./examples.js')

// console.log('HYDRA', Hydra)
// const HydraShaders = require('./../shader-generator.js')

function init () {
const PerformanceUI = require('./performance-ui')
const audioPanel = require('./panels/audio')

//   const canvas = document.createElement('canvas')
//   canvas.style.backgroundColor = "#000"
//   canvas.width = 800
//   canvas.height = 200
//   document.body.appendChild(canvas)
//   // canvas.style.width = '100%'
//   // canvas.style.height = '100%'
// //  exampleCustomCanvas()


window.hydra = new Hydra({detectAudio:true, detectMidi: true, makeGlobal: true, matchMedia: true})
setResolution(1920, 1080)

// document.addEventListener('click', () => { a.initStream() }, { once: true })
  
var defaultEditorValue = `


var knob1 = () => midi.knob(0, { min: 3, max: 6, step: true })
var knob2 = () => midi.knob(1, { min: 1, max: 6, smooth: 0.2 })
var knob3 = () => midi.knob(2, { min: 1, max: 6, step: true })
var knob4 = () => midi.knob(3, { min: 1, max: 6, smooth: 0.9 })



var bin1 = () => Math.min(1, a.fft[3] / 3)*3 + 0.25
var background = shape(knob1, bin1).repeat(knob2, knob3).kaleid(knob4)

var knob5 = () => midi.knob(4, { min: 25, max: 100, smooth: 0.9 })

var foreground = osc(knob5,-0.1).kaleid(50).pixelate(40,40)

foreground.layer(background.colorama(20)).out()


`

// osc(10,2).mult(shape(4,0.1,2).kaleid(3)).repeat(4).out()
//midiDemo()
// audioDemo()
// exampleVideo()
// exampleResize()
//nonGlobalCanvas()

//s0.initVideo("https://media.giphy.com/media/26ufplp8yheSKUE00/giphy.mp4", {})
//src(s0).repeat().out()
a.initStream()
update = () => { document.title = hydra.synth.stats.fps + ' fps' }
const _prevUpdate = update
update = () => { _prevUpdate(); window.performanceUI && window.performanceUI.tick() }
initEditor(defaultEditorValue)
window.performanceUI = new PerformanceUI()
window.performanceUI.register(audioPanel)
}

function initEditor (editorValue) {
  const editor = document.createElement('textarea')
  const style = editor.style
  style.position = 'fixed'
  style.bottom = '0'
  style.left = '0'
  style.width = '100%'
  style.height = '30vh'
  style.background = 'rgba(0,0,0,0.75)'
  style.color = '#0ff'
  style.fontFamily = 'monospace'
  style.fontSize = '14px'
  style.padding = '12px'
  style.boxSizing = 'border-box'
  style.border = 'none'
  style.borderTop = '1px solid #0ff4'
  style.resize = 'vertical'
  style.zIndex = '9999'
  style.display = 'none'

  if(!editorValue){
    editor.value = `
        
    
    shape(4, 0.5)
    .scale(0.5, 0.5, () => (a.fft[3] * 40 + 2) / 10)
    .out()
    
    `
  }else{
    editor.value = editorValue
  }
  

  document.body.appendChild(editor)

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      editor.style.display = editor.style.display === 'none' ? 'block' : 'none'
      if (editor.style.display === 'block') editor.focus()
    }
  })

  let prettier = null
  async function loadPrettier () {
    if (prettier) return prettier
    await loadScript('https://unpkg.com/prettier@3/standalone.js')
    await loadScript('https://unpkg.com/prettier@3/plugins/estree.js')
    await loadScript('https://unpkg.com/prettier@3/plugins/babel.js')
    prettier = { format: window.prettier.format, plugins: [window.prettierPlugins.estree, window.prettierPlugins.babel] }
    return prettier
  }

  editor.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      try {
        eval(editor.value)
      } catch (err) {
        console.error('[editor]', err)
      }
    }
    if (e.key === 'F' && e.shiftKey && e.altKey) {
      e.preventDefault()
      try {
        const p = await loadPrettier()
        const formatted = await p.format(editor.value, { parser: 'babel', plugins: p.plugins, semi: false, singleQuote: true })
        const pos = editor.selectionStart
        editor.value = formatted
        editor.selectionStart = editor.selectionEnd = pos
      } catch (err) {
        console.error('[editor] format error:', err)
      }
    }
    if (e.key === 'Escape') {
      e.stopPropagation()
      editor.style.display = 'none'
    }
  })
}

window.onload = init
