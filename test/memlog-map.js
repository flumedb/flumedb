var pull = require('pull-stream')
var tape = require('tape')
var Flume = require('../')
var MemLog = require('flumelog-memory')

module.exports = function (flume) {
  var errorEnabled = false

  var db = flume(MemLog(), false, (val, cb) => {
    setTimeout(() => {
      if (true === errorEnabled) {
        return cb(new Error('error enabled for testing'))
      }
      val = JSON.parse(JSON.stringify(val))
      val.called = (val.called  || 0) + 1
      val.map = true
      cb(null, val)
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
        t.deepEqual(value.called, 1)
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
          t.deepEqual(ary, [ { foo: 1, called: 1, map: true }, { foo: 2, called: 1, map: true } ])
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
            { value: { foo: 1, called: 1, map: true }, seq: 0 },
            { value: { foo: 2, called: 1, map: true }, seq: 1 },
            { value: { foo: 3, called: 1, map: true }, seq: 2 },
            { value: { foo: 4, called: 1, map: true }, seq: 3 }
          ])
          t.end()
        })
      )
    })
  })

  tape('get map with error', function (t) {
    errorEnabled = true
    db.append({foo: 13}, function (err, seq) {
      if(err) throw err
      console.log("GET", err, seq)
      db.get(seq, function (err, value) {
        console.log(  "GET", err, value)
        t.ok(err)
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



