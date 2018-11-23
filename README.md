# flumedb

A modular database made for moving logs with streams.

## architecture

Flume is a modular database compromised of an Append Only Log,
and then Streaming Views on that log.
This makes a star shaped pipeline - or rather, there is a pipeline
from the log to each view, but the log is part of every pipeline.

The Log compromises the main storage, and provides durability.
Views stream that data and build up their own model. They
can point back to the main storage (normalized) or materialize it
(denormalized). The views can use a structure optimized for
the queries they provide, instead of durability, because the
can rebuild from the main log.

In my previous modular database design, [level-sublevel](https://github.com/dominictarr/level-sublevel)
indexes had to be written atomically with the data. This was
okay for map style indexes, but made simple aggregations such
as a count of all records difficult. Worse, rebuilding the indexes
needed a batch migration between two versions of the database.
This made developing interesting applications on level-sublevel quite difficult (such as [secure-scuttlebutt](https://scuttlebutt.nz))

In flume, each view remembers a version number, and if the version
number changes, it just rebuilds the view. This means view code can
be easily updated, or new views added. It just rebuilds the view on
startup. (though, this may take a few minutes on larger data)

The trick is that each view exposes a observable, flumeview.since,
this _represents_ it's current state - the sequence number the view is up to.
An observable is like an event meets a value. it's an changing value that you can observe.
Events, promises, or streams are similar, but not quite the right choice here.

Note, views are async. The main log may callback before the view is
fully up to date, but if a read is made to a as yes unsynced view,
it just waits for the view building to complete. This may make
the call take longer (applications should show a progress bar
for reindexing) but most of the application code can just assume
that indexes are always up to date, because if you get a callback
from an append to the log, a subsequent view read will return
data consistent with that.

This gives us the freedom to have async views,
which gives us the freedom to have many different sorts of views!

## example

Take one `flumelog-*` module and zero or more `flumeview-*` modules,
and glue them together with `flumedb`.

``` js
var MemLog = require('flumelog-memory') // just store the log in memory
var Reduce = require('flumeview-reduce') //just a reduce function.
var Flume = require('flumedb')

var db = Flume(MemLog())
  //the api of flumeview-reduce will be mounted at db.sum...
  .use('sum', Reduce(1, function (acc, item) {
    return (acc || 0) + item.foo
  }))

db.append({foo: 1}, function (err, seq) {
  db.sum.get(function (err, value) {
    if(err) throw err
    console.log(value) // 1
  })
})

```

## modules

There are two types of components, logs, which you need just one of,
and views, which you want many of. I expect that the list of view modules
will grow much longer than the list of log modules.

### logs

* [flumedb/flumelog-offset](https://github.com/flumedb/flumelog-offset) a log in a _file_ *recommended*.
* [flumedb/flumelog-memory](https://github.com/flumedb/flumelog-memory) a log that is just an in memory array.
* [flumedb/flumelog-level](https://github.com/flumedb/flumelog-level) a log on level.
* [flumedb/flumelog-idb](https://github.com/flumedb/flumelog-idb) flumelog on top of indexeddb.

### views

* [flumedb/flumeview-reduce](https://github.com/flumedb/flumeview-reduce) a reduce function as a view.
* [flumedb/flumeview-level](https://github.com/flumedb/flumeview-level) an implemented index on level.
* [flumedb/flumeview-query](https://github.com/flumedb/flumeview-query) functional query language.
* [flumedb/flumeview-search](https://github.com/flumedb/flumeview-search) full text search.
* [flumedb/flumeview-hashtable](https://github.com/flumedb/flumeview-hashtable) hashtable is ideal when you have uniqueish keys and do not need range queries.
* [flumedb/flumeview-bloom](https://github.com/flumedb/flumeview-bloom) bloom filter lets you check if _may_ have something.

### other

other modules that may come in handy

* [flumedb/flumecodec](https://github.com/flumedb/flumecodec) simple codecs, used in most views and logs.
* [dominictarr/charwise](https://github.com/dominictarr/charwise) an order-preserving encoding compatible with bytewise, but faster.
* [flumedb/flumecli](https://github.com/flumedb/flumecli) instance command line interface
* [flumedb/aligned-block-file](https://github.com/flumedb/aligned-block-file) read and write to a file with aligned blocks that are easy to cache.
* [flumedb/test-flumelog](https://github.com/flumedb/test-flumelog) reusable tests for a flumelog.

## api

### flumedb api

#### Flume(flumelog, isReady?, mapper?) => flumedb

construct a flumedb instance from a `flumelog`.
if `isReady` is false, nothing will happen with the views until `flumedb.ready.set(true)`
is called. This is useful if some sort of migration needs to happen before everything starts
processing.

`mapper` is an optional async function `function (value, cb) { cb(null, value) }`
that map apply some transformation onto a data item before passing it to the views,
`get` or `stream`.

#### flumedb.get (seq, cb)

This exposes `get` from the underlying `flumelog` module.
This takes a `seq` as is the keys in the log,
and returns the value at that sequence or an error.

#### flumedb.stream (opts)

This exposes `stream` from the underlying `flumelog` module.
It supports options familiar from leveldb ranges, i.e. `lt`, `gt`, `lte`, `gte`, `reverse`, `live`, `limit`.

#### flumedb.since => observable

The [observable](https://github.com/dominictarr/obv) which represents the state of the log.
This will be set to -1 if the view is empty, will monotonically increase as the log is appended
to. The particular format of the number depends on the implementation of the log,
but should usually be a number, for example, a incrementing integer, a timestamp, or byte offset.

#### flumedb.append (value, cb(err, seq))

Appends a value to the database. The encoding of this value will be handled by the `flumelog`,
will callback when value is successfully written to the log (or it errors).
On success, the callback will return the new maximum sequence in the log.

If `value` is an array of values, it will be treated as a batched write.
By the time of the callback, flumedb.since will have been updated.

#### flumedb.use(name, createFlumeview) => self

Installs a `flumeview` module.
This will add all methods that the flumeview describes in it's `modules` property to `flumedb[name]`
If `name` is already a property of `flumedb` then an error will be thrown.
You probably want to add plugins at startup, but given the streaming async nature of flumedb,
it will work completely fine if you add them later!

#### flumedb.rebuild (cb)

Destroys all views and rebuilds them from scratch. If you have a large database and lots of views
this might take a while, because it must read completely through the whole database again.
`cb` will be called once the views are back up to date with the log. You can continue using
the various read APIs and appending to the database while it is being rebuilt,
but view reads will be delayed until those views are up to date.

#### flumedb.close(cb)

closes all flumeviews.

#### flumedb.closed => boolean

set to true if `flumedb.close()` has been called

---

### flumelog api

The flume _log_ is the heart of the `flumedb` setup - it's the cannonical store of data, and all state is stored there.
In contrast, all flume _views_ are derived / generated completely from the data in the log, so they can be blown away and regenerated easily.

Each type of log defines the following methods, which are then exposed by flumedb (e.g. `flumelog.get` is what defines `flumedb.get`) for you to access.

#### flumelog.get (seq, cb)

Retrives the value at position `seq` in the log.

#### flumelog.stream(opts)

Returns a source stream over the log.
It supports options familiar from leveldb ranges, i.e. `lt`, `gt`, `lte`, `gte`, `reverse`, `live`, `limit`.

#### flumelog.since => observable

An observable which represents the state of the log. If the log is uninitialized
it should be set to `undefined`, and if the log is empty it should be `-1` if the log has data,
it should be a number larger or equal to zero.

#### flumelog.append (value, cb(err, seq))

Appends a value (or array of values) to the log, and returns the new latest sequence.
`flumelog.since` is updated before calling `cb`.

#### flumelog.dir => directory name

The filename of the directory this flumelog is persisted in
(this is used by the views, if they are also persistent).

---

### flumeview api

A `flumeview` provides a read API, and a streaming sink that accepts data from the log
(this will be managed by `flumedb`).

#### flumeview.since => observable

The current state of the view (this must be the sequence of the last value processed by the view)
a flumeview _must_ process items from the main log in order, otherwise inconsistencies will occur.

#### flumeview.createSink (cb)

Returns a pull-stream sink that accepts data from the log. The input will be `{seq, value}` pairs.
`cb` will be called when the stream ends (or errors).

#### flumeview.destroy (cb)

Wipe out the flumeview's internal (and persisted) state, and reset `flumeview.since` to `-1`.

#### flumeview.close (cb)

flush any pending writes and release resources, etc.

#### flumeview.methods = {\<key\>:'sync'|'async'|'source'}

An object describing the methods exposed by this view.
A view needs to expose at least one method
(otherwise, why is it useful?).

These the corresponding methods will be added at `flumedb[name][key]`.
If they type is `async` or `source` the actual call to the `flumeview[key]` method will
be delayed until `flumeview.since` is in up to date with the log.
`sync` type methods will be called immediately.

#### flumeview.ready (cb)

A `ready` method is also added to each mounted `flumeview` which takes a callback
which will be called exactly once, when that view is up to date with the log
(from the point where it is called).

## License

MIT

