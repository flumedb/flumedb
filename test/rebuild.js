// This test ensures that when we rebuild the database, each of the messages is
// correctly re-passed to each view for processing. This is important when the
// `mapper` option is used for things like decryption, because you may want to
// rebuild the database each time you receive a new decryption key.
//
// Right now this test is targeting Flumeview-Level, but you *should* be able
// to switch it out for any other view.

const Log = require('flumelog-offset')
const Flume = require('..')
const ViewLevel = require('flumeview-level')
const codec = require('flumecodec')
const tap = require('tap')

const log = Log(`/tmp/foo-${Date.now()}.log`, { codec: codec.json })

const db = Flume(log)

tap.plan(16)

let messagesSeen = 0
const messagesExpected = 7

db.use(
  'level',
  ViewLevel(log, (x) => {
    messagesSeen += 1
    tap.pass(`${messagesSeen}/${messagesExpected}`)
    return [x.foo]
  })
)

db.append({ foo: 1 }, function (err) {
  tap.error(err, 'no error after append 1')
  db.append({ foo: 2 }, function (err) {
    tap.error(err, 'no error after append 2')
    db.level.get(2, (err) => {
      tap.error(err, 'no error after level.get()')
      db.rebuild((err) => {
        tap.error(err, 'no error after rebuild')
        db.append({ foo: 3 }, function (err) {
          tap.error(err, 'no error after append 3')
          db.append({ foo: 4 }, function (err) {
            tap.error(err, 'no error after append 4')
            db.append({ foo: 5 }, function (err) {
              tap.error(err, 'no error after append 4')
              db.level.get(4, (err) => {
                tap.error(err, 'no error after level.get()')
                db.close((err) => {
                  tap.error(err, 'no error after close')
                  tap.end()
                })
              })
            })
          })
        })
      })
    })
  })
})
