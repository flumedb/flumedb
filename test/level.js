var Flume = require('../')
var LevelLog = require('flumelog-level')

var testOpts = { InjectedValue: 'injected2' }

require('./memlog')
  (Flume(LevelLog('/tmp/test_flumedb-levellog'+Date.now()), testOpts), testOpts)
