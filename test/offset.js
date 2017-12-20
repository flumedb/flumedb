var Flume = require('../')
var OffsetLog = require('flumelog-offset')

var testOpts = { InjectedValue: 'injected' }

require('./memlog')
  (Flume(OffsetLog('/tmp/test_flumedb-offset'+Date.now()+'/log', 1024, require('flumecodec/json')), testOpts), testOpts)
