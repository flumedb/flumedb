var PullCont = require('pull-cont')
var pull = require('pull-stream')

module.exports = function wrap(sv, flume) {
  var since = flume.since, isReady = flume.ready
  var waiting = []

  var meta = {}

  function throwIfClosed(name) {
    if(flume.closed) throw new Error('cannot call:'+name+', flumedb instance closed')
  }

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
    source: function (fn, name) {
      return function (opts) {
        throwIfClosed(name)
        meta[name] ++
        return pull(PullCont(function (cb) {
          ready(function () { cb(null, fn(opts)) })
        }), pull.through(function () { meta[name] ++ }))
      }
    },
    async: function (fn, name) {
      return function (opts, cb) {
        throwIfClosed(name)
        meta[name] ++
        ready(function () {
          fn(opts, cb)
        })
      }
    },
    sync: function (fn, name) {
      return function (a, b) {
        throwIfClosed(name)
        meta[name] ++
        return fn(a, b)
      }
    }
  }

  var o = {ready: ready, since: sv.since, close: sv.close, meta: meta, destroy: sv.destroy}
  if(!sv.methods) throw new Error('a stream view must have methods property')

  for(var key in sv.methods) {
    var type = sv.methods[key]
    var fn = sv[key]
    if(typeof fn !== 'function') throw new Error('expected function named:'+key+'of type: '+type)
    //type must be either source, async, or sync
    meta[key] = 0
    o[key] = wrapper[type](fn, key)
  }

  o.methods = sv.methods

  return o
}




