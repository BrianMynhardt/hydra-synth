
const Hydra = require('./../')
// import Hydra from './../src/index.js'
const loop = require('raf-loop')
const { fugitiveGeometry, exampleVideo, exampleResize, nonGlobalCanvas, midiDemo } = require('./examples.js')

// console.log('HYDRA', Hydra)
// const HydraShaders = require('./../shader-generator.js')

function init () {

//   const canvas = document.createElement('canvas')
//   canvas.style.backgroundColor = "#000"
//   canvas.width = 800
//   canvas.height = 200
//   document.body.appendChild(canvas)
//   // canvas.style.width = '100%'
//   // canvas.style.height = '100%'
// //  exampleCustomCanvas()


window.hydra = new Hydra({detectAudio:false, detectMidi: true, makeGlobal: true, matchMedia: true})
setResolution(2000, 980)


// osc(10,2).mult(shape(4,0.1,2).kaleid(3)).repeat(4).out()
midiDemo()
// exampleVideo()
// exampleResize()
//nonGlobalCanvas()

//s0.initVideo("https://media.giphy.com/media/26ufplp8yheSKUE00/giphy.mp4", {})
//src(s0).repeat().out()
}

window.onload = init
