var statistics = require('statistics')
var pull = require('pull-stream')

var tape = require('tape')

var Flume = require('../')

var MemLog = require('flumelog-memory')
var Reduce = require('flumeview-reduce')
var Obv = require('obv')

module.exports = function (db) {
  db.use('stats', Reduce(1, function (acc, data) {
    return statistics(acc, data.foo)
  }))

  tape('empty db', function (t) {
    db.stats.get(function (err, value) {
      if(err) throw err
      t.equal(value, undefined)
      t.end()
    })
  })

  tape('simple', function (t) {

    db.since(function (v) { 
      console.log("SINCE", v)
    }, false)

    db.append({foo: 1}, function (err, seq) {
      if(err) throw err
      console.log("GET", err, seq, db.stats)
      db.stats.get([], function (err, value) {
        if(err) throw err
        console.log(  "GET", value)
        t.deepEqual(value.mean, 1)
        t.deepEqual(value.stdev, 0)
        t.end()
      })
    })
  })

  tape('append', function (t) {
    db.append({foo: 3}, function (err, seq) {
      if(err) throw err
      console.log("GET", err, seq)
      db.stats.get([], function (err, value) {
        if(err) throw err
        console.log(  "GET", value)
        t.deepEqual(value.mean, 2)
        t.deepEqual(value.stdev, 1)
        t.end()
      })
    })
  })

  tape('get items in stream', function (t) {
    pull(
      db.stream({seqs: true, values: false}),
      pull.asyncMap(function (seq, cb) {
        db.get(seq, cb)
      }),
      pull.collect(function (err, ary) {
        if(err) throw err
        t.deepEqual(ary, [{foo: 1}, {foo: 3}])
        t.end()
      })
    )

  })

  tape('disable ready to stall all reads', function (t) {
    var called = false
    db.ready.set(false)
    db.stats.get([], function (err, value) {
      called = true
    })
    setTimeout(function () {
      t.equal(db.ready.value, false)
      t.equal(called, false)
      db.ready.set(true)
      t.equal(called, true) //this should fire immediately
      t.end()
    }, 100)

  })

  tape('rebuild a view that is ahead', function (t) {
    var obv = Obv()
    var since = db.since.value+1
    obv.set(since)
    var reset = false
    db.use('ahead', function (log, name) {
      return {
        methods: {},
        since: obv,
        createSink: function (opts) {
          console.log(obv.value, db.since.value)
          t.ok(obv.value <= db.since.value, 'createSink should not be called unless within an acceptable range')
          t.ok(reset)
          t.end()
        },
        destroy: function (cb) {
          reset = true
          obv.set(-1)
          cb()
        }
      }
    })
  })

  tape('close', function (t) {
    db.close(function () {
      t.end()
    })
  })

  tape('append after close', function (t) {
    try {
      db.append({bar: 4}, function (err, data, seq) {
        t.fail('should have thrown')
      })
    } catch (err) {
      t.ok(err)
//      t.end()
    }
    try {
      db.stats.get(function (err, data, seq) {
        t.fail('should have thrown')
      })
    } catch (err) {
      t.ok(err)
    }
    t.end()
  })

}

if(!module.parent)
  function map (value, cb) {
    setImmediate(function () {
      cb(null, value)
    })
  }
  module.exports(Flume(MemLog()))
  module.exports(Flume(MemLog(), null, map))




