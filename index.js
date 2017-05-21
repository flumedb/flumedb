'use strict'
var cont = require('cont')
var PullCont = require('pull-cont')
var pull = require('pull-stream')
var path = require('path')
var Obv = require('obv')
//take a log, and return a log driver.
//the log has an api with `read`, `get` `since`

function wrap(sv, since, isReady) {
  var waiting = []

  sv.since(function (upto) {
    if(!isReady.value) return
    while(waiting.length && waiting[0].seq <= upto)
      waiting.shift().cb()
  })

  isReady(function (ready) {
    if(!ready) return
    var upto = sv.since.value
    if(upto == undefined) return
    while(waiting.length && waiting[0].seq <= upto)
      waiting.shift().cb()
  })

  function ready (cb) {
    if(isReady.value && since.value != null && since.value === sv.since.value) cb()
    else
      since.once(function (upto) {
        if(isReady.value && upto === sv.since.value) cb()
        else waiting.push({seq: upto, cb: cb})
      })
  }

  var wrapper = {
    source: function (fn) {
      return function (opts) {
        return PullCont(function (cb) {
          ready(function () { cb(null, fn(opts)) })
        })
      }
    },
    async: function (fn) {
      return function (opts, cb) {
        ready(function () {
          fn(opts, cb)
        })
      }
    },
    sync: function (fn) { return fn }
  }

  var o = {ready: ready, since: sv.since, close: sv.close }
  if(!sv.methods) throw new Error('a stream view must have methods property')

  for(var key in sv.methods) {
    var type = sv.methods[key]
    var fn = sv[key]
    if(typeof fn !== 'function') throw new Error('expected function named:'+key+'of type: '+type)
    //type must be either source, async, or sync
    o[key] = wrapper[type](fn)
  }

  o.methods = sv.methods

  return o
}


function map(obj, iter) {
  var o = {}
  for(var k in obj)
    o[k] = iter(obj[k], k, obj)
  return o
}

module.exports = function (log, isReady) {
  var views = []
  var ready = Obv()
  ready.set(isReady !== undefined ? isReady : true)
  var flume = {
    dir: log.filename ? path.dirname(log.filename) : null,
    //stream from the log
    since: log.since,
    ready: ready,
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

      sv.since.once(function (upto) {
        pull(
          log.stream({gt: upto, live: true, seqs: true, values: true}),
          sv.createSink(function (err) {
            if(err) console.error(err)
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







