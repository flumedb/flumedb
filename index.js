'use strict'
var cont = require('cont')
var pull = require('pull-stream')
var PullCont = require('pull-cont')
var path = require('path')
var Obv = require('obv')
var explain = require('explain-error')
var Looper = require('pull-looper')
var asyncMap = require('pull-stream/throughs/async-map')

//take a log, and return a log driver.
//the log has an api with `read`, `get` `since`

var wrap = require('./wrap')

function map(obj, iter) {
  var o = {}
  for(var k in obj)
    o[k] = iter(obj[k], k, obj)
  return o
}

function asyncify () {
  return function (read) {
    return function (abort, cb) {
      setImmediate(function () {
        read(abort, cb)
      })
    }
  }
}

module.exports = function (log, isReady, mapper) {
  var meta = {}

  log.get = count(log.get, 'get')

  function count (fn, name) {
    meta[name] = meta[name] || 0
    return function (a, b) {
      meta[name] ++
      fn.call(this, a, b)
    }
  }

  function rebuildView (sv, cb) {
    sv.destroy(function (err) {
      if(err) return cb(err)
      //destroy should close the sink stream,
      //which will restart the write.
      let shouldDelete = false
      const rm = sv.since(function (v) {
        if (shouldDelete === true) return rm()

        if(v === log.since.value) {
          shouldDelete = true
          const _cb = cb
          cb = null
          _cb()
        }
      })
    })
  }

  var ready = Obv()
  ready.set(isReady !== false ? true : undefined)

  var mapStream = opts => {
    if (opts.values === false)
      return
    else if (opts.seqs === false)
      return asyncMap(mapper)
    else
      return asyncMap((data, cb) => {
        mapper(data.value, (err, value) => {
          if(err) cb(err)
          else {
            data.value = value
            cb(err, data)
          }
        })
      })
  }

  function get (seq, cb) {
    if(mapper)
      log.get(seq, function (err, value) {
        if(err) cb(err)
        else mapper(value, cb)
      })
    else
      log.get(seq, cb)
  }

  function stream (opts) {
    return pull(
        log.stream(opts),
        mapper ? mapStream(opts) : null,
        Looper
      )
  }

  function throwIfClosed(name) {
    if(flume.closed) throw new Error(`cannot call: ${name}, flumedb instance closed`)
  }

  var flume = {
    closed: false,
    dir: log.filename ? path.dirname(log.filename) : null,
    //stream from the log
    since: log.since,
    ready: ready,
    meta: meta,
    append: function (value, cb) {
      throwIfClosed('append')
      return log.append(value, cb)
    },
    stream: function (opts) {
      throwIfClosed('stream')
      return PullCont(function (cb) {
        log.since.once(function () {
          cb(null, stream(opts))
        })
      })
    },
    get: function (seq, cb) {
      throwIfClosed('get')
      log.since.once(function () {
        get(seq, cb)
      })
    },
    del: function (seq, cb) {
      throwIfClosed('del')
      log.since.once(() => log.del(seq, (err) => {
        if (err) return cb(err)

        // Delete item from each view, then callback.
        Promise.all(Object.values(flume.views).map(view =>
          new Promise((resolve, reject) => {

            // Simple callback handler for promises.
            const promiseCb = (err) => {
              if (err) {
                reject(err)
              } else {
                resolve()
              }
            }

            if (typeof view.del === 'function') {
              // If view supports deletion, use `flumeview.del()` method.
              view.del(seq, promiseCb)
            } else {
              // Otherwise, rebuild the view.
              rebuildView(view, promiseCb)
            }
          })
        )).catch((err) => cb(err))
          .then(() => cb(null, seq)) 
      }))
    },
    use: function (name, createView) {
      if(~Object.keys(flume).indexOf(name))
        throw new Error(`${name} is already in use!`)
      throwIfClosed('use')

      var sv = createView(
        {get: get, stream: stream, since: log.since, filename: log.filename}
        , name)

      flume.views[name] = flume[name] = wrap(sv, flume)
      meta[name] = flume[name].meta
      sv.since.once(function build (upto) {
        log.since.once(function (since) {
          if(upto > since) {
            sv.destroy(function () { build(-1) })
          } else {
            var opts = {gt: upto, live: true, seqs: true, values: true}
            if (upto == -1)
              opts.cache = false
            pull(
              stream(opts),
              Looper,
              sv.createSink(function (err) {
                if(!flume.closed) {
                  if(err)
                    console.error(explain(err, `view stream error, from: ${name}`))
                  sv.since.once(build)
                }
              })
            )
          }
        })
      })

      return flume
    },
    rebuild: function (seqs, cb) {
      if (typeof seqs === 'function' && cb == null) {
        cb = seqs
        seqs = null
      }

      // pass an array!
      if (typeof seqs === 'number') {
        seqs = [ seqs ]
      }

      throwIfClosed('rebuild')
      return cont.para(map(flume.views, function (sv) {
        return function (cb) {
          if (typeof sv.rebuild === 'function' && seqs != null) {
            sv.rebuild(seqs, cb)
          } else {
            //destroying will stop createSink stream
            //and flumedb will restart write.
            sv.destroy(function (err) {
              if(err) return cb(err)
              //when the view is up to date with log again
              //callback, but only once, and then stop observing.
              //(note, rare race condition where sv might already be set,
              //so called before rm is returned)
              var rm = sv.since(function (v) {
                if(v === log.since.value) {
                  var _cb = cb; cb = null; _cb()
                }
                if(!cb && rm) rm()
              })
            })
          }
        }
      }))(cb)
    },
    close: function (cb) {
      if(flume.closed) return cb()
      flume.closed = true
      cont.para(map(flume.views, function (sv, k) {
        return function (cb) {
          if(sv.close) sv.close(cb)
          else cb()
        }
      })) (cb)

    },
    views: {}
  }
  return flume
}

