var Flume = require('../')
var LevelLog = require('flumelog-level')

require('./memlog')
  (Flume(LevelLog('/tmp/test_flumedb-levellog'+Date.now())))


//XXX there is a bug in flumelog-level!
//something to do with inconsistent support for stream options, seqs, values ?
//require('./memlog-map')
//  (LevelLog('/tmp/test_flumedb-levellog-map'+Date.now()))


