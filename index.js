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

//take a log, and return a log driver.
//the log has an api with `read`, `get` `since`

var wrap = require('./wrap')

function map(obj, iter) {
  var o = {}
  for(var k in obj)
    o[k] = iter(obj[k], k, obj)
  return o
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
    if(flume.closed) throw new Error(`FlumeDB cannot call method ${name} while database is closed`)
  }
  function throwIfRebuilding(name) {
    if(flume.closed) throw new Error(`FlumeDB cannot call method ${name} while database is rebuilding`)
  }
  const buildView = (sv) => {
      sv.since.once(function build (upto) {
        console.log(`Building view ${sv.name} from ${upto}`)
        const rebuildView = () => {
          console.log(`Auto-rebuild called for ${sv.name}`)
          // TODO - create some debug logfile and log that we're rebuilding, what error was
          // so that we have some visibility on how often this happens over time
          sv.destroy(() => build(-1))
        }

        log.since.once(function (since) {
          //if the view is ahead of the log somehow, destroy the view and rebuild it.
          if(upto > since) rebuildView()
          else {
            var opts = {gt: upto, live: true, seqs: true, values: true}
            if (upto == -1)
              opts.cache = false

            const abortable = pullAbortable();

            flume.views[sv.name].abort = abortable.abort
            console.log(`Starting stream: ${sv.name}`, opts)

            pull(
              stream(opts),
              abortable,
              Looper,
              sv.createSink(function (err) {
                if(flume.closed === false) {
                  if (err) {
                    if (err.abort) {
                      console.log(`Aborted view ${sv.name}`)
                    } else {
                      console.log(err)
                      console.error(explain(err, `rebuilding ${sv.name} after view stream error`))
                      rebuildView()
                    }
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

  var flume = {
    closed: false,
    rebuilding: false,
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
    use: function (name, createView) {
      if(~Object.keys(flume).indexOf(name))
        throw new Error(name + ' is already in use!')
      throwIfClosed('use')

      var sv = createView({
        get,
        stream,
        since: log.since,
        filename: log.filename,
      }, name)


      if (typeof sv.close !== 'function') {
        throw new Error('views in this version of flumedb require a .close method')
      }

      sv.name = name

      flume.views[name] = flume[name] = wrap(sv, flume)
      meta[name] = flume[name].meta

      buildView(sv)

      return flume
    },
    rebuild: function (cb) {
      console.log('Rebuild method called')
      throwIfClosed('rebuild')
      throwIfRebuilding('rebuild')

      flume.rebuilding = true

      return cont.para(map(flume.views, function (sv) {
        return function (cb) {
          //destroying will stop createSink stream
          //and flumedb will restart write.
          sv.destroy(function (err) {
            console.log(`View destroyed: ${sv.name}`)
            if(err) return cb(err)
            sv.abort({ abort: true })
            sv.abort = () => {}
            sv.since.set(-1)
            buildView(sv)
            //when the view is up to date with log again
            //callback, but only once, and then stop observing.
            //(note, rare race condition where sv might already be set,
            //so called before rm is returned)
            var rm = sv.since(function (v) {
              console.log('Status update', {
                name: sv.name,
                view: v,
                log: log.since.value
              })
              if(v === log.since.value && cb) {
                console.log('View is up-to-date:', sv.name)
                var _cb = cb; cb = null; _cb()
              }
              if(!cb && rm) rm()
            })
          })
        }
      }))((...args) => {
        flume.rebuilding = false
        cb(...args)
      })
    },
    close: function (cb) {
      if(flume.closed) return cb()
      flume.closed = true
      cont.para(map(flume.views, function (sv, k) {
        return function (cb) {
          if(sv.close) sv.close(cb)
          else cb()
        }
      })) (function (err) {
        if(!log.close)
          cb(err)
        else
          log.close(cb)
      })

    },
    views: {}
  }

  for(var key in log.methods) {
    var type = log.methods[key]
    var fn = log[key]
    if(typeof fn !== 'function') {
      throw new Error(`expected function named: "${key}" of type: "${type}"`)
    }
    if(flume[key] != null) {
      throw new Error(`log method "${key}" conflicts with flumedb method of the same name`)
    }

    flume[key] = log[key]
  }

  return flume
}

