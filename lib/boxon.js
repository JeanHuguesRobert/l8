// boxon.js
//   Boxons are promise friendly functional callbacks
//
// (C) 2014, Jean Hugues Robert -- github.com/JeanHuguesRobert -- @jhr
// MIT License
//
// Please look for test suite in test/boxon.js

"use strict";

(function scope( scoped, opt_factory ){
  
  var noop = function(){};
  var slice = [].slice;
  var factory = opt_factory;
  // Use ECMAScript 6 Promise factory when one is available
  if( !scoped && typeof Promise !== "undefined" ){
    factory = Promise;
  }

  // Boxon factory, create an instance
  var boxon = function( x ){
    
    // Instance data members, captured by closure
    var box, on, ctx, outcome, promise, resolver, rejector;
    
    // Create the instance, it is a Function
    box = function( f, f2 ){
      var then;
      // When called to track another boxon
      if( f && typeof f.boxon === "function" ){
        f.boxon( function(){
          if( then )return;
          then = true;
          box.apply( box, arguments );
        });
      // When called to track a thenable, ie box( a_thenable )
      }else if( f
      && (typeof f === "object" || typeof f === "function" )
      && typeof (then = f.then) === "function"
      ){
        if( f === box )return box;
        then.call( f, 
          function( ok ){ box( null, ok ) },
          function( ko ){ box( ko )       }
        );
        if( arguments.length > 2 ){
          box.apply( box, Array.prototype.slice( 2 ) );
        }
      // When called with some callbacks, ie box( fn [, fn2] )
      }else if( typeof f === "function" ){
        // When about thenable callbacks, ie box( f1, f2 )
        if( typeof f2 === "function" ){
          return box.then( f, f2 );
        // When about the sync callback, ie box( fn [, ctx] )
        }else if( outcome ){
          f.apply( f2 || box, outcome );
        // When about callback to call when boxon gets delivered
        }else{
          // Either remember or signal {Boxon:xx,on:ff,context:yy} event
          if( on ){
            on.call( ctx, { Boxon: box, on: f, context: f2 || box } );
          }else{
            on  = f;
            ctx = f2 || box;
          }
        }
      // When called about an async call, ie box( target, fn [, ...params] )
      }else if( f && typeof f2 === "function" ){
        f2.apply( f, Array.prototype.slice( 2 ).push( box ) );
      // When called to set outcome, ie box( err, ...result )
      }else if( !outcome ){
        outcome = arguments;
        // Call callbacks that were installed before outcome was delivered
        if( promise ){
          if( outcome[0] ){
            rejector( outcome[0] );
          }else{
            resolver( outcome.length > 2
              ? Array.prototype.slice( outcome, 1 )
              : outcome[1]
            );
          }
        }
        if( on ){ on.apply( ctx, outcome ); }
        if( !arguments.length )return;
      // When called to get memorized outcome, ie box()
      }else if( !arguments.length ){
        if( outcome[0] )throw outcome[0];
        if( outcome.length <= 2 )return outcome[1];
        return slice.call( outcome, 1 );
      // When called set outcome again, ignore
      }else{}
      return box;
    };
    
    // Make instance thenable, requires a Promise factory
    if( factory ){
      box.then = function( f1, f2 ){
        return (promise || (promise = factory( function( rslv, rjct ){
          resolver = rslv;
          rejector = rjct;
          if( !outcome )return;
          if( outcome[0] ){
            rejector( outcome[0] );
          }else{
            resolver( outcome.length > 2
              ? Array.prototype.slice( outcome, 1 )
              : outcome[1]
            );
          }
        }) )).then( f1, f2 );
      };
      box.catch = function( f ){ return this.then( null, f ); };
    }
    
    // Duck typing/boxon detection: x && typeof x.boxon === "function"
    box.boxon = box;
    
    arguments.length && box.apply( null, arguments );
    return box;
  };
  
  // Moxons are boxons with multiple callbacks
  var moxon = boxon.Moxon = function(){
    var queue = [];
    var box = boxon( function( err ){
      if( err && err.Boxon ){
        queue.push( err );
        return;
      }
      for( var cb, ii = 0 ; cb = queue[ ii++ ] ; ){
        cb.on.apply( cb.context, arguments );
      }
    });
    return arguments.length
    ? box.apply( null, arguments )
    : box;
  };
  
  boxon.all = moxon.all = function( a ){
    var box = boxon();
    var result = [];
    var len = a.length;
    if( !len )return box( null, result );
    var ii = 0;
    var countdown = len;
    var b;
    while( ii < len ){
      b = a[ ii ];
      if( !b || typeof b.boxon !== "function" ){
        if( b && typeof b.then === "function" ){
          b = boxon( b );
        }else{
          b = boxon()( null, b );
        }
      }
      result[ ii++ ] = b;
      b( function(){ if( !--countdown ){ box( null, result ); } } );
    }
    return box;
  };
  
  boxon.race = moxon.all = function( a ){
    var win = boxon();
    var done;
    var b;
    var ii = 0;
    var len = a.length;
    while( ii < len ){
      b = a[ii++];
      if( !b || typeof b.boxon !== "function" ){
        if( b && typeof b.then === "function" ){
          b = boxon( b );
        }else{
          b = boxon()( null, b );
        }
      }
      b( function(){
        done = true;
        win.apply( win, arguments );
      });
      if( done )break;
    }
    return win;
  };
  
  // Interop with other implementations
  boxon.cast = moxon.cast = boxon;
  
  boxon.promise = moxon.promise = function( f ){
    if( !arguments.length )return factory;
    factory = f;
    return boxon;
  };
  boxon.scope = function( factory ){ return scope( true, factory ); };
  
  // Export global Boxon, platform dependant
  if( !scoped ){
    typeof module !== "undefined" && "exports" in module && (module.exports = boxon);
    typeof global !== "undefined" && (global.Boxon = boxon);
    typeof window !== "undefined" && (window.Boxon = boxon);
  }

  // Smoke test
  0 && moxon( function( _, m ){ console.log( "sync: " + m ); } )( null, "Hello Boxon" );
  
  return boxon;
    
})();


