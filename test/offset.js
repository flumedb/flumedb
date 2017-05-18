var Flume = require('../')
var OffsetLog = require('flumelog-offset')

require('./memlog')
  (Flume(OffsetLog('/tmp/test_flumedb-offset'+Date.now()+'/log', 1024, require('flumecodec/json'))))
