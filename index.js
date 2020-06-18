'use strict'
var cont = require('cont')
var pull = require('pull-stream')
var PullCont = require('pull-cont')
var path = require('path')
var Obv = require('obv')
var explain = require('explain-error')
var Looper = require('pull-looper')
var asyncMap = require('pull-stream/throughs/async-map')
var pullAbortable = require('pull-abortable')

// take a log, and return a log driver.
// the log has an api with `read`, `get` `since`

var wrap = require('./wrap')

function map (obj, iter) {
  var o = {}
  for (var k in obj) o[k] = iter(obj[k], k, obj)
  return o
}

module.exports = function (log, isReady, mapper) {
  const buildView = (sv) => {
    sv.since.once(function build (upto) {
      const rebuildView = () => {
        // TODO - create some debug logfile and log that we're rebuilding, what error was
        // so that we have some visibility on how often this happens over time
        sv.destroying = true
        sv.destroy(() => {
          sv.destroying = false
          build(-1)
        })
      }

      log.since.once(function (since) {
        if (upto > since) rebuildView()
        else {
          var opts = { gt: upto, live: true, seqs: true, values: true }
          if (upto === -1) opts.cache = false

          // Before starting a stream it's important that we configure some way
          // for FlumeDB to close the stream! Previous versions of FlumeDB
          // would rely on each view having some intelligent stream closure
          // that seemed to cause lots of race conditions. My hope is that if
          // we manage strema cancellations in FlumeDB rather than each
          // individual Flumeview then we'll have fewer race conditions.
          const abortable = pullAbortable()
          sv.abortStream = abortable.abort

          pull(
            stream(opts),
            abortable,
            Looper,
            sv.createSink(function (err) {
              // If FlumeDB is closed or this view is currently being
              // destroyed, we don't want to try to immediately restart the
              // stream. This saves us a bit of sanity
              if (!flume.closed && sv.destroying === false) {
                // The `err` value is meant to be either `null` or an error,
                // but unfortunately Pull-Write seems to abort streams with
                // an error when it shouldn't. Fortunately these errors have
                // an extra `{ abort. true }` property, which makes them easy
                // to identify. Errors where `{ abort: true }` should be
                // handled as if the error was `null`.
                if (err && err.abort !== true) {
                  console.error(
                    explain(err, `rebuilding ${sv.name} after view stream error`)
                  )
                  rebuildView()
                } else {
                  sv.since.once(build)
                }
              }
            })
          )
        }
      })
    })
  }
  var meta = {}

  log.get = count(log.get, 'get')

  function count (fn, name) {
    meta[name] = meta[name] || 0
    return function (a, b) {
      meta[name]++
      fn.call(this, a, b)
    }
  }

  var ready = Obv()
  ready.set(isReady !== false ? true : undefined)

  var mapStream = (opts) => {
    if (opts.values === false) {
      return
    }
    if (opts.seqs === false) {
      return asyncMap(mapper)
    }

    return asyncMap((data, cb) => {
      mapper(data.value, (err, value) => {
        if (err) cb(err)
        else {
          data.value = value
          cb(err, data)
        }
      })
    })
  }

  function get (seq, cb) {
    if (mapper) {
      log.get(seq, function (err, value) {
        if (err) cb(err)
        else mapper(value, cb)
      })
    } else log.get(seq, cb)
  }

  function stream (opts) {
    return pull(
      log.stream(opts),
      mapper ? mapStream(opts) : null,
      Looper
    )
  }

  function throwIfClosed (name) {
    if (flume.closed) {
      throw new Error('cannot call:' + name + ', flumedb instance closed')
    }
  }

  var flume = {
    closed: false,
    dir: log.filename ? path.dirname(log.filename) : null,
    // stream from the log
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
    use: function (name, createView) {
      if (~Object.keys(flume).indexOf(name)) {
        throw new Error(name + ' is already in use!')
      }
      throwIfClosed('use')

      var sv = createView(
        { get: get, stream: stream, since: log.since, filename: log.filename },
        name
      )

      const requiredMethods = ['close', 'createSink', 'destroy', 'since']

      requiredMethods.forEach((methodName) => {
        if (typeof sv[methodName] !== 'function') {
          throw new Error(
            `FlumeDB view '${name}' must implement method '${methodName}'`
          )
        }
      })

      flume.views[name] = flume[name] = wrap(sv, flume)
      meta[name] = flume[name].meta

      flume.views[name].name = name

      // if the view is ahead of the log somehow, destroy the view and rebuild it.
      buildView(flume.views[name])

      return flume
    },
    rebuild: function (cb) {
      return cont.para(
        map(flume.views, function (sv) {
          // First, we need to abort the stream to this view. This prevents new
          sv.destroying = true
          // messages from being sent during `destroy()`, which could lead to
          // race conditions and leftover data.
          sv.abortStream()

          // Then we return a function that calls back when the view is
          // up-to-date.
          return function (cb) {
            // The `destroy()` function does **not** stop the `createSink()`
            // stream, that happens when we call `sv.abortStream()` above. The
            // `destroy()` method should call back once the database is empty,
            // and `sv.since` should be set to `-1`.
            sv.destroy(function (err) {
              sv.destroying = false
              if (err) return cb(err)

              // There isn't a clear separation of responsibility here: should
              // the views set their `since` value here, or should FlumeDB? I
              // don't think there are any problems with both FlumeDB and the
              // view setting this value, but this might be an exercise in
              // paranoia.
              // sv.since.set(-1)

              // Stream: CANCELLED.
              // Database: EMPTY.
              // Since: -1.
              //
              // Now we just need to re-stream all of the messages to the view.
              // This should make `sv.since` slowly increment as it processes
              // each // message, and eventually it'll catch up to `log.since`.
              buildView(sv)

              // Each time `sv.since` changes, we want to compare it to
              // `log.since`. Once they're the same, the view is done
              // rebuilding and we can call back.
              //
              // Sometimes naughty views might set since to the same value
              // twice (!) so we have to reassign `cb` to avoid calling it
              // twice. This idiom is slightly confusing but I'm too scared to
              // refactor it.
              var rm = sv.since(function (v) {
                if (v === log.since.value && typeof cb === 'function') {
                  var _cb = cb
                  cb = null
                  _cb()
                }
                if (!cb && rm) rm()
              })
            })
          }
        })
      )(cb)
    },
    close: function (cb) {
      if (flume.closed) return cb()
      flume.closed = true
      cont.para(
        map(flume.views, function (sv, k) {
          return function (cb) {
            if (sv.abortStream) sv.abortStream()
            if (sv.close) sv.close(cb)
            else cb()
          }
        })
      )(function (err) {
        if (!log.close) cb(err)
        else log.close(cb)
      })
    },
    views: {}
  }

  for (var key in log.methods) {
    var type = log.methods[key]
    var fn = log[key]
    if (typeof fn !== 'function') {
      throw new Error(`expected function named: "${key}" of type: "${type}"`)
    }
    if (flume[key] != null) {
      throw new Error(
        `log method "${key}" conflicts with flumedb method of the same name`
      )
    }

    flume[key] = log[key]
  }

  return flume
}
