var Flume = require('../')
var LevelLog = require('flumelog-level')

require('./memlog')
  (Flume(LevelLog('/tmp/test_flumedb-levellog'+Date.now())))
