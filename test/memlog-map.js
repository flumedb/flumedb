var pull = require('pull-stream')
var tape = require('tape')
var Flume = require('../')
var MemLog = require('flumelog-memory')

module.exports = function (flume) {
  var db = flume(MemLog(), false, (value, cb) => {
    setTimeout(() => {
      value.map = true
      cb(value)
    }, Math.random() * 10)
  })

  tape('get map', function (t) {
    db.since(function (v) {
      console.log("SINCE", v)
    }, false)

    db.append({foo: 1}, function (err, seq) {
      if(err) throw err
      console.log("GET", err, seq)
      db.get(seq, function (err, value) {

        if(err) throw err
        console.log(  "GET", value)
        t.deepEqual(value.foo, 1)
        t.deepEqual(value.map, true)
        t.end()
      })
    })
  })

  tape('stream map only values', function (t) {
    db.append({foo: 2}, function (err, seq) {
      if(err) throw err
      console.log("GET", err, seq)
      pull(
        db.stream({seqs: false, values: true }),
        pull.collect(function (err, ary) {
          if(err) throw err
          t.deepEqual(ary, [ { foo: 1, map: true }, { foo: 2, map: true } ])
          t.end()
        })
      )
    })
  })

  tape('stream map only seqs', function (t) {
    db.append({foo: 3}, function (err, seq) {
      if(err) throw err
      console.log("GET", err, seq)
      pull(
        db.stream({seqs: true, values: false }),
        pull.collect(function (err, ary) {
          if(err) throw err
          t.deepEqual(ary,  [ 0, 1, 2 ])
          t.end()
        })
      )
    })
  })

  tape('stream map values and seqs', function (t) {
    db.append({foo: 4}, function (err, seq) {
      if(err) throw err
      console.log("GET", err, seq)
      pull(
        db.stream({seqs: true, values: true }),
        pull.collect(function (err, ary) {
          if(err) throw err
          t.deepEqual(ary,  [
            { value: { foo: 1, map: true }, seq: 0 },
            { value: { foo: 2, map: true }, seq: 1 },
            { value: { foo: 3, map: true }, seq: 2 },
            { value: { foo: 4, map: true }, seq: 3 }
          ])
          t.end()
        })
      )
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


