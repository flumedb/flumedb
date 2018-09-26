var pull = require('pull-stream')
var tape = require('tape')
var Flume = require('../')
var MemLog = require('flumelog-memory')
var Reduce = require('flumeview-reduce')

module.exports = function (log) {
  var errorEnabled = false

  var db = Flume(log, true, (val, cb) => {
    console.log("MAP", val)
    if(val === undefined) throw new Error('weird: val is undefined')
    setTimeout(() => {
      if (true === errorEnabled) {
        return cb(new Error('error enabled for testing'))
      }
      val = val != undefined ? JSON.parse(JSON.stringify(val)) : undefined
      val.called = (val.called  || 0) + 1
      val.map = true
      cb(null, val)
    }, Math.random() * 10)
  })

  db.use('called', Reduce(1, function (acc, data) {
    return (acc || 0) + data.called
  }))

  tape('get map', function (t) {
    db.since(function (v) {
      console.log("SINCE", v)
    }, false)

    db.append({foo: 1}, function (err, seq) {
      if(err) throw err
      db.get(seq, function (err, value) {
        if(err) throw err
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
          t.ok(ary.every(function (e) { return 'number' === typeof e }))
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
          t.deepEqual(ary.map(function (e) { return e.value }),  [
            { foo: 1, called: 1, map: true },
            { foo: 2, called: 1, map: true },
            { foo: 3, called: 1, map: true },
            { foo: 4, called: 1, map: true }
          ])
          t.end()
        })
      )
    })
  })

  tape('check that reduce has happened', function (t) {
    t.ok(db.called)
    db.called.get(null, function (err, count) {
      console.log(err, count)
      if(err) throw err
      t.equal(count, 4)
      t.end()
    })
  })

//  tape('get map with error', function (t) {
//    errorEnabled = true
//    db.append({foo: 13}, function (err, seq) {
//      if(err) throw err
//      console.log("GET", err, seq)
//      db.get(seq, function (err, value) {
//        console.log(  "GET", err, value)
//        t.ok(err)
//        t.end()
//      })
//    })
//  })
//

  tape('close', function (t) {
    db.close(function () {
      t.end()
    })
  })
}

if(!module.parent)
  module.exports(MemLog())

