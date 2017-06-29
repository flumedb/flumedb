'use strict'
var cont = require('cont')
var pull = require('pull-stream')
var PullCont = require('pull-cont')
var path = require('path')
var Obv = require('obv')
//take a log, and return a log driver.
//the log has an api with `read`, `get` `since`

var wrap = require('./wrap')

function map(obj, iter) {
  var o = {}
  for(var k in obj)
    o[k] = iter(obj[k], k, obj)
  return o
}

module.exports = function (log, isReady) {
  var views = []
  var meta = {}
  var closed = false

  log.get = count(log.get, 'get')
//  log.stream = count(log.stream, 'stream')

  function count (fn, name) {
    meta[name] = meta[name] || 0
    return function (a, b) {
      meta[name] ++
      fn.call(this, a, b)
    }
  }

  var ready = Obv()
  ready.set(isReady !== undefined ? isReady : true)
  var flume = {
    dir: log.filename ? path.dirname(log.filename) : null,
    //stream from the log
    since: log.since,
    ready: ready,
    meta: meta,
    append: function (value, cb) {
      return log.append(value, cb)
    },
    stream: function (opts) {
      return PullCont(function (cb) {
        log.since.once(function () {
          cb(null, log.stream(opts))
        })
      })
    },
    get: function (seq, cb) {
      log.since.once(function () {
        log.get(seq, cb)
      })
    },
    use: function (name, createView) {
      if(~Object.keys(flume).indexOf(name))
        throw new Error(name + ' is already in use!')

      var sv = createView(log, name)

      views[name] = flume[name] = wrap(sv, log.since, ready)
      meta[name] = flume[name].meta
      sv.since.once(function (upto) {
        pull(
          log.stream({gt: upto, live: true, seqs: true, values: true}),
          sv.createSink(function (err) {
            if(err && !closed) console.error(err)
          })
        )
      })

      return flume
    },
    rebuild: function (cb) {
      return cont.para(map(views, function (sv) {
        return function (cb) {
          sv.destroy(function (err) {
            if(err) return cb(err)
            sv.since.once(function (upto) {
              pull(
                log.stream({gt: upto, live: true, seqs: true, values: true}),
                sv.createSink(function (err) {
                  if(err) console.error(err)
                })
              )
            })
          })
        }
      }))
      (function (err) {
        if(err) cb(err) //hopefully never happens

        //then restream each streamview, and callback when it's uptodate with the main log.
      })
    },
    close: function (cb) {
      if(closed) throw new Error('already closed')
      closed = true
      cont.para(map(views, function (sv, k) {
        return function (cb) {
          if(sv.close) sv.close(cb)
          else cb()
        }
      })) (cb)

    }
  }
  return flume
}








