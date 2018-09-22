var tape = require('tape')
var Flume = require('../')
var MemLog = require('flumelog-memory')

module.exports = function (flume) {
  var db

  tape('map', function (t) {
    db = flume(MemLog(), false, (value, cb) => {
      setTimeout(() => {
        value.mapWorks = true
        cb(value)
      }, Math.random() * 10)
    })

    db.since(function (v) {
      console.log("SINCE", v)
    }, false)

    db.append({foo: 1}, function (err, seq) {
      if(err) throw err
      console.log("GET", err, seq, db.stats)
      db.get(seq, function (err, value) {

        if(err) throw err
        console.log(  "GET", value)
        t.deepEqual(value.foo, 1)
        t.deepEqual(value.mapWorks, true)
        t.end()
      })
    })
  })

  tape('close', function (t) {
    db.close(function () {
      t.end()
    })
  })
}

if(!module.parent)
  module.exports(Flume)


