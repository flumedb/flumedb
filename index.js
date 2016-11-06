'use strict'
var cont = require('cont')
var PullCont = require('pull-cont')
var pull = require('pull-stream')

//take a log, and return a log driver.
//the log has an api with `read`, `get` `since`

function wrap(sv, since) {
  var waiting = []

  sv.since(function (upto) {
    while(waiting.length && waiting[0].seq <= upto)
      waiting.shift().cb()
  })

  function ready (cb) {
    if(since.value != null && since.value === sv.since.value) cb()
    else
      since.once(function (upto) {
        if(upto === sv.since.value) cb()
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
        if(!cb) cb = opts, opts = null
        ready(function () {
          fn(opts, cb)
        })
      }
    },
    sync: function (fn) { return fn }
  }

  var o = {ready: ready, since: sv.since}
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

module.exports = function (log) {
  var views = []

  var flume = {
    //stream from the log
    since: log.since,
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

      views[name] = sv
      flume[name] = wrap(sv, log.since)

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
        return function (cb) { sv.destroy(cb) }
      }))
      (function (err) {
        if(err) cb(err) //hopefully never happens

        //then restream each streamview, and callback when it's uptodate with the main log.
        //
      })
    },
    append: function (value, cb) {
      return log.append(value, cb)
    }
  }
  return flume
}



