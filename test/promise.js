// promise.js
//   adapter for promises-aplus/promises-tests
// See https://github.com/promises-aplus/promises-tests

var Parole = require( "l8/lib/whisper" );

module.exports.deferred = function(){
  var p = Parole();
  return {
    promise: p,
    resolve: function( v ){ return p.resolve( v ); },
    reject:  function( r ){ return p.reject(  r ); }
  };
};

// If debugging
if( 0 ){
  var promisesAplusTests = require("promises-aplus-tests");
  require( "mocha-unfunk-reporter" );
  promisesAplusTests(
    module.exports,
    { reporter: "mocha-unfunk-reporter", grep: "" },
    function (err) {}
  );
}
