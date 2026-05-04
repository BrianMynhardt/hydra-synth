
const Hydra = require('./../')
// import Hydra from './../src/index.js'
const loop = require('raf-loop')
const { fugitiveGeometry, exampleVideo, exampleResize, nonGlobalCanvas } = require('./examples.js')

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


window.hydra = new Hydra({detectAudio:false, makeGlobal: true, matchMedia: true})
setResolution(2000, 980)

 var shapes = [
    shape(4)
      .scale(1, 0.5, [0.5, 1, 2])
      .scrollX(0.3),
    shape(4)
      .scale(1, 0.5, [0.5, 1, 2].smooth(0.5))
      .scrollX(0.0),
    shape(4)
      .scale(1, 0.5, [0.5, 1, 2].smooth())
      .scrollX(-0.3),
  ]

  solid()
    .add(shapes[0])
    .add(shapes[1])
    .add(shapes[2])
    .out(o0)
// console.log(hydra)
// window.hydra = hydra
// // //osc().out()
// exampleVideo()
// exampleResize()
//nonGlobalCanvas()

//s0.initVideo("https://media.giphy.com/media/26ufplp8yheSKUE00/giphy.mp4", {})
//src(s0).repeat().out()
}

window.onload = init
