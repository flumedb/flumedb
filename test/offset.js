var Flume = require('../')
var OffsetLog = require('flumelog-offset')

require('./memlog')
  (Flume(OffsetLog('/tmp/test_flumedb-offset'+Date.now()+'/log', 1024, require('flumecodec/json'))))
require('./memlog')
  (Flume(
    OffsetLog('/tmp/test_flumedb-offset'+Date.now()+'/log', 1024, require('flumecodec/json')),
    null,
    function (val, cb) {
      cb(null, val)
    }
))

require('./memlog-map')
  (OffsetLog('/tmp/test_flumedb-offset2'+Date.now()+'/log', 1024, require('flumecodec/json')))


