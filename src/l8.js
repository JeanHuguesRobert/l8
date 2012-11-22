// l8.js
//   Task/promise manager
//   https://github.com/JeanHuguesRobert/l8
//
// 2012/10/24, JHR, create

var L8 = null
var l8 = null

var Util = null
try{
  Util = require( "util")
  Util.debug( "entering l8.js")
}catch( e ){}

TraceStartTask = 18

function trace(){
  var buf = ["L8"]
  for( var ii = 0 ; ii < arguments.length ; ii++ ){
    if( arguments[ii] ){ buf.push( arguments[ii]) }
  }
  buf = buf.join( ", ")
  try{
    if( Util ){
      Util.puts( buf)
    }else{
      console.log( buf)
    }
    if( buf.indexOf( "DEBUG") >=  0 ){
      // please set breakpoint here to debug
      false && breakpoint()
    }
  }catch( e ){
    // ToDo: host adapted tracing
  }
  return buf
}

function Task( parent ){
  this.id              = ++L8.taskCount
  this.isRoot          = !parent
  this.parentTask      = parent
  this.subTasks        = {}
  this.subTaskCount    = 0
  this.queuedTasks     = {}
  this.queuedTaskCount = 0
  this.beginStack      = []
  this.stepCount       = 0
  this.firstStep       = null
  this.lastStep        = null
  this.currentStep     = null
  this.nextStep        = null
  this.pausedStep      = null
  this.stepResult      = undefined
  this.stepError       = undefined
  this.wasCanceled     = false
  this.shouldStop      = false
  this.isDone          = false
  this.successBlock    = null
  this.failureBlock    = null
  this.progressBlock   = null
  this.finalBlock      = null
  this.allPromises     = null
  this.local           = {}
  if( parent ){
    this.local = parent.local
    parent.subTasks[this.id] = this
    parent.subTaskCount++
  }
  if( TraceStartTask && L8.taskCount >= TraceStartTask )trace( "New", this)
}
Task.prototype = Task

function Step( task, parent, previous, block ){
  this.id          = ++task.stepCount
  this.isForked    = false
  this.isRepeated  = false
  this.task        = task
  this.parentStep  = parent
  this.block       = block
  this.isBlocking  = true
  this.previous    = null
  this.next        = null
  // When inserting at head
  if( !previous ){
    this.next      = task.firstStep
    if( this.next ){ this.next.previous = this }
    task.firstStep = task.lastStep = task.currentStep = this
  // When inserting at tail
  }else if( !previous.next ){
    this.previous      = previous
    this.previous.next = this
    task.lastStep      = this
  // When inserting in the middle of the list
  }else{
    this.previous = previous
    this.next     = previous.next
    previous.next.previous = this
    previous.next = this
  }
  if( TraceStartTask && L8.taskCount >= TraceStartTask ){
    trace(
      "New", this,
      this === task.firstStep ? "first" : "",
      this === task.lastStep  ? "last"  : ""
    )
  }
}
Step.prototype = Step

// Bootstrap root task, id 0
L8 = {taskCount:-1}
L8 = l8 = new Task()
L8.l8          = L8
L8.taskCount   = 0
L8.stepQueue   = []
L8.isScheduled = false
var CurrentStep = new Step( L8)
try{
  L8.nextTick = process.nextTick
  L8.nextTick( function(){})
}catch( e ){
  L8.nextTick = function next_tick( block ){ setTimeout( block, 0) }
  L8.nextTick( function(){})
}

L8.cancelEvent   = {l8:"cancel"}
L8.breakEvent    = {l8:"break"}
L8.continueEvent = {l8:"continue"}
L8.returnEvent   = {l8:"return"}

L8.scheduler = function scheduler(){
// Inject the global scheduler in the global event loop.
// It executes queued steps and their next ones.
  function tick(){
    L8.isScheduled = false
    var step
    while( step = L8.stepQueue.shift() ){
      step.execute()
      step.scheduleNext()
    }
    CurrentStep = L8.currentStep
    L8.scheduler()
  }
  if( !L8.isScheduled ){
    // ToDo: better browser support, see nextTick in
    // https://github.com/kriskowal/q/blob/master/q.js
    L8.nextTick( tick)
    L8.isScheduled = true
  }
}

L8.enqueueStep = function enqueue_step( step ){
  if( false ){
    if( step.wasQueued ){
      throw trace( "requeue bug: " + step)
    }
    step.wasQueued = true
  }
  if( step == "!Task 5/3" )trace( "DEBUG enqueue", step)
  L8.stepQueue.push( step)
  step.isBlocking = false
  if( TraceStartTask && L8.taskCount >= TraceStartTask ){
    var item
    for( var ii = 0 ; ii < L8.stepQueue.length ; ii++ ){
      item = L8.stepQueue[ii]
      trace(
        "enqueued step[" + ii + "]",
        item,
        item.isRepeated ? "repeat" : "",
        item.isForked   ? "fork"   : "",
        item.isBlocking ? "pause"  : ""
      )
    }
  }
}

Step.execute = function step_execute(){
  var task         = this.task
  if( TraceStartTask && L8.taskCount >= TraceStartTask ){
    trace(
      "DEBUG execute", this,
      task.isDone             ? "task done" : "",
      this.isBlocking         ? "blocking"  : "",
      this.isRepeated         ? "repeated"  : "",
      this.isForked           ? "forked"    : "",
      this === task.firstStep ? "first"     : "",
      this === task.lastStep  ? "last"      : ""
    )
  }
  if( task.isDone )throw new Error( "BUG, execute a done l8 step: " + this)
  if( this.isBlocking )return
  task.currentStep = this
  CurrentStep      = this
  task.nextStep    = this.next
  try{
    if( this.block ){
      if( this.block.length > 1 ){
        task.stepResult = this.block.apply( task, task.stepResult)
      }else{
        task.stepResult = this.block.apply( task, [task.stepResult])
      }
      task.progressing()
    }
  }catch( e ){
    task.stepError = e
  }finally{
    task.nextStep = null
  }
}

Step.scheduleNext = function schedule_next(){
  var task = this.task
  if( task.isDone )throw new Error( "Bug, schedule a done l8 task: " + this)
  if( this.isBlocking )return
  var redo = this.isRepeated
  if( task.stepError ){
    if( task.stepError === L8.continueEvent ){
      redo = true
      task.stepError = undefined
    }else if( task.stepError === L8.breakEvent ){
      redo = false
    }
  }
  var queue = task.queuedTasks
  var subtasks
  var subtask_id
  var subtask
  if( !task.stepError ){
    var next_step = redo ? this : this.next
    if( next_step ){
      if( !next_step.isForked || redo ){
        // Regular steps wait for forked subtasks, fork steps don't
        for( subtask in queue ){
          this.isBlocking = true
          task.pausedStep = this
          return
        }
      }
      if( redo ){
        L8.nextTick( function(){ L8.enqueueStep( next_step) })
      }else{
        L8.enqueueStep( next_step)
      }
      return
    }
    // When all steps are done, wait for spawn subtasks
    this.isBlocking = true
    task.pausedStep = this
    for( subtask in queue )return
    subtasks = task.subTasks
    for( subtask_id in subtasks ){
      subtask = subtasks[subtask_id]
      if( subtask.isDone || queue[subtask.id] )continue
      queue[subtask.id] = task
      return
    }
  // When error, cancel all subtasks
  }else{
    subtasks = task.subTasks
    for( subtask_id in subtasks ){
      subtask = subtasks[subtask_id]
      if( !subtask.isDone ){
        subtask.cancel()
      }
    }
  }
  // When nothing more, handle task termination
  this.isBlocking = true
  task.pausedStep = null
  task.isDone     = true
  var exit_repeat = false
  try{
    if( task.stepError === L8.returnEvent ){
      task.stepError = undefined
    }else if( task.stepError === L8.breakEvent ){
      task.stepError = undefined
      exit_repeat    = true
    }
    task.progressing()
    try{
      if( task.stepError ){
        if( task.failureBlock ){
          try{
            task.failureBlock( task.stepError)
          }catch( e ){
            throw e
          }
        }else{
          throw task.stepError
        }
      }else{
        if( task.successBlock ){
          try{
            task.successBlock( task.stepResult)
          }catch( e ){
            throw e
          }
        }
      }
    }catch( e ){
      task.stepError = e
      // ToDo: should throw or not?
      throw e
    }finally{
      if( task.finalBlock ){
        try{
          task.finalBlock( task.stepError, task.stepResult)
        }catch( e ){
          throw e
        }
      }
      if( task.allPromises ){
        var err  = task.stepError
        var rslt = task.stepResult
        var list = task.allPromises
        var len  = list.length
        var item
        for( var ii = 0 ; ii < len ; ii++ ){
          item = list[ii]
          if( !item )continue
          if( err ){
            item.reject( err)
          }else{
            item.resolve( rslt)
          }
        }
      }
    }
  }catch( e ){
    task.stepError = e
    if( task.parentTask ){ task.parentTask.raise( e) }
  }finally{
    try{
      if( exit_repeat && task.parentTask ){
        if( task.parentTask.currentStep.isRepeated ){
          task.parentTask.currentStep.isRepeated = false
        }else{
          task.stepError = L8.breakEvent
          task.parentTask.raise( L8.breakEvent)
        }
      }
    }finally{
      if( task.parentTask ){ task.parentTask.subtaskDone( task) }
    }
  }
}

Task.Task = function task_task( fn ){
  return function (){
    var task = CurrentStep.task
    try{
      task = task.begin
      fn.apply( task, arguments)
    }catch( e ){
      throw e
    }finally{
      task.end
    }
    return task
  }
}

Task.toString = function task_to_string(){ return "Task " + this.id }

Task.__defineGetter__( "current", function(){
  return this.isRoot ? CurrentStep.task : this
})

Task.__defineGetter__( "task", function(){
  return this.isRoot ? CurrentStep.task : this
})

Task.__defineGetter__( "begin", function(){
  var task = CurrentStep.task
  // When "begin" means "create a new task"
  if( task === L8 || task.isDone ){
    task = new Task( L8)
    task.beginStack.push( true)
  }else{
    task.beginStack.push( false)
  }
  return task
})

Task.__defineGetter__( "end", function(){
  var task  = this.current
  var stack = task.beginStack
  var top   = stack[stack.length - 1]
  if( top != top ){
    // TODO: check balance
    throw new Error( "Unbalanced L8.end")
  }
  var new_task = stack.pop()
  if( new_task && !stack.length ){
    if( !task.firstStep ){
      new Step( task, CurrentStep, null, null)
    }
    // When first step can run immediately
    if( !task.queuedTaskCount ){
      L8.enqueueStep( task.firstStep)
    // When first step is after forks
    }else{
      // Pause task to wait for forks, need a new "first step" for that
      new Step( task, task.firstStep.parentStep, null, null)
      task.pausedStep = task.firstStep
    }
    stack.push( true)
  }
  return task
})

Task.__defineGetter__( "done", function(){
  return this.current.isDone
})

Task.__defineGetter__( "succeed", function(){
  var task = this.current
  return task.isDone && !task.err
})

Task.__defineGetter__( "fail", function(){
  var task = this.current
  return task.isDone && task.err
})

Task.__defineGetter__( "result", function(){
  return this.current.stepResult
})

Task.__defineSetter__( "result", function( val){
  return this.current.stepResult = val
})

Task.__defineGetter__( "error", function(){
  return this.current.stepError
})

Task.__defineGetter__( "stop", function(){
  var task = this.current
  task.shouldStop = true
  return task
})

Task.__defineGetter__( "stopping", function(){
  var task = this.current
  return task.shouldStop && !task.isDone
})

Task.__defineGetter__( "stopped", function(){
  var task = this.current
  return task.shouldStop && task.isDone
})

Task.__defineGetter__( "canceled", function(){
  return this.current.wasCanceled
})

Task.step = function step( block, is_forked, is_repeated ){
  var task = this.current
  if( task.isDone )throw new Error( "Can't add new step, l8 task is done")
  var parent_step  = task.currentStep ? task.currentStep.parentStep : null
  var insert_after = task.nextStep    ? task.nextStep.previous : task.lastStep
  var step = new Step( task, parent_step, insert_after, block)
  if( is_forked   ){ step.isForked   = true }
  if( is_repeated ){ step.isRepeated = true }
  return task
}

Task.fork = function task_fork( block, starts_paused, detached, repeated ){
  if( TraceStartTask && L8.taskCount >= TraceStartTask ){
    trace( this.current.currentStep , "invokes fork()",
      starts_paused ? "paused"   : "",
      detached      ? "detached" : "",
      repeated      ? "repeated" : ""
    )
  }
  return this.step( function(){
    var task = this.current
    if( TraceStartTask && L8.taskCount >= TraceStartTask ){
      trace( task.currentStep , "executes scheduled fork",
        starts_paused ? "paused"   : "",
        detached      ? "detached" : "",
        repeated      ? "repeated" : ""
      )
    }
    var new_task = new Task( task)
    // var scoped_block = task.Task( block)
    var step = new Step( new_task, task.currentStep, null, block)
    if( starts_paused ){
      // Pause task, need a new "first step" for that
      new Step( new_task, task.currentStep, null, null)
      new_task.pausedStep = new_task.firstStep
      new_task.pausedStep = step
    }else{
      L8.enqueueStep( step)
    }
    if( !detached ){
      task.queuedTasks[new_task.id] = new_task
      task.queuedTaskCount++
    }
  }, true, repeated) // is_forked
}

Task.spawn = function task_spawn( block, starts_paused ){
  return this.fork( block, starts_paused, true) // detached
}

Task.repeat = function task_repeat( block ){
  return this.fork( block, false, false, true) // repeated
}

Task.subtaskDone = function subtask_done( subtask ){
  var task = this //.current
  if( task.queuedTaskCount
  &&  task.queuedTasks[subtask.id]
  ){
    delete task.queuedTasks[subtask.id]
    if( --task.queuedTaskCount === 0 ){
      if( task.pausedStep ){ task.resume() }
      // ToDo: error propagation
    }
  }
}

Task.__defineGetter__( "tasks", function(){
  var buf = []
  var tasks = this.subTasks
  for( var k in tasks ){
    buf.push( tasks[k])
  }
  return buf
})

Task.__defineGetter__( "parent", function(){
  return this.current.parentTask
})

Task.__defineGetter__( "root", function(){
  var task = this.current
  if( !task.parentTask )return task
  while( true ){
    if( task.parentTask === L8 )return task
    task = task.parentTask
  }
})

Task.__defineGetter__( "paused", function(){
  var task = this.current
  return !!task.pausedStep
})

Task.pause = function pause( yields, yield_value ){
  var task = this.current
  var step = task.currentStep
  if( step.isBlocking ){
    throw new Error( "Cannot pause, already blocked l8 task")
  }
  task.pausedStep = step
  step.isBlocking = true
  if( yields ){ task.stepResult = yield_value }
  return task
}

Task.yield = function task_yield( value ){
  return this.pause( true, value)
}

Task.resume = function task_resume( yields, yield_value ){
  var task = this.current
  var paused_step = task.pausedStep
  if( !paused_step ){
    throw new Error( "Cannot resume, not paused l8 task")
  }
  if( !paused_step.isBlocking ){
    throw new Error( "Cannot resume, running l8 step")
  }
  task.pausedStep = null
  if( yields ){ task.stepResult = yield_value }
  paused_step.isBlocking = false
  paused_step.scheduleNext()
  return task
}

Task.run = function task_run( value ){
  return this.resume( true, value)
}

Task.raise = function task_raise( err ){
  var task = this.current
  if( task.isDone )return
  task.stepError = err
  if( task.pausedStep ){
    task.resume()
  }else{
    var step = task.currentStep
    if( step ){
      if( step.isBlocking ){
        step.isBlocking = false
        step.scheduleNext()
      }else if( step === CurrentStep ){
        throw err
      }
    }else{
      trace( "Unhandled exception", e, e.stack)
    }
  }
  return task
}

Task.throw = Task.raise

Task.cancel = function task_cancel(){
  var task    = this.current
  var done    = false
  var on_self = false
  while( !done ){
    done = true
    var tasks = task.tasks
    for( var subtask in tasks ){
      if( subtask.wasCanceled )continue
      if( subtask.currentStep === CurrentStep ){
        on_self = subtask
      }else{
        done = false
        subtask.cancel()
      }
    }
  }
  if( !on_self && task !== CurrentStep.task ){
    task.wasCanceled = true
    task.raise( L8.cancelEvent)
  }
  return task
}

Task.progressing = function task_progressing(){
  if( this.progressBlock ){
    try{
      this.progressBlock( this)
    }catch( e ){
      // ToDo
    }
  }
  var list = this.allPromises
  if( !list )return
  var len  = list.length
  var item
  for( var ii = 0 ; ii < len ; ii++ ){
    item = list[ii]
    if( item.progressBlock ){
      try{
        var val = item.progressBlock( this)
        // ToDo: propagate progress in promise chain
      }catch( e ){
        // ToDo
      }
    }
  }
}

Task._return = Task["return"] = function task_return( val ){
  var task = this.current
  if( task.isDone ){
    throw new Error( "Cannot _return, done l8 task")
  }
  task.stepResult = val
  task.raise( L8.returnEvent)
}
Task.__defineGetter__( "continue", function task_continue(){
  return this.raise( L8.continueEvent)
})

Task.__defineGetter__( "_break", function task__break(){
  return this.raise( L8.breakEvent)
})

Task.__defineGetter__( "break",  function task_break(){
  return this.raise( L8.breakEvent)
})

Task.__defineGetter__( "_continue", function task__continue(){
  return this.raise( L8.continueEvent)
})

Task.__defineGetter__( "continue", function task_continue(){
  return this.raise( L8.continueEvent)
})

Task.walk = function walk( block ){
  var task = this.current
  var step = task.currentStep
  if( step.isBlocking ){
    // ToDo: test/allow multiple walk()
    // throw new Error( "Can't walk, not running")
  }
  step.isBlocking = true
  return function walk_cb(){
    if( task.currentStep !== step ){
      // ToDo: quid if multiple walk() fire?
      // throw new Error( "Cannot walk same step again")
    }
    var previous_step = CurrentStep
    CurrentStep = step
    var result
    if( arguments.length === 1 ){
      result = arguments[0]
    }else{
      result = arguments
    }
    try{
      // ToDo: block should run as if from next step ?
      // ToDo: block should run as a new step ?
      if( block ){
        result = block.apply( task, arguments)
      }
      if( task.currentStep === step ){
        if( step.isBlocking ){
          task.stepResult = result
          step.isBlocking = false
          step.scheduleNext()
        }
      }
    }catch( e ){
      task.raise( e)
    }finally{
      CurrentStep = previous_step
      L8.scheduler()
    }
  }
}

Task.__defineGetter__( "next", function(){
  return this.walk( null)
})

Step.toString = function(){ return this.task.toString() + "/" + this.id }

Task.final = function final( block ){
  var task = this.current
  task.finalBlock = block
  return task
}

Task.finally = Task.final

Task.failure = function failure( block ){
  var task = this.current
  task.failureBlock = block
  return task
}

Task.catch = Task.failure

Task.success = function success( block ){
  var task = this.current
  task.successBlock = block
  return task
}

Task.then = function task_then( success, failure, progress ){
  if( this.isDone ){
    // ToDo: should allow this
    throw new Error( "Cannot provide promise on alreay done l8 task")
  }
  var promise = new Promise()
  if( !this.allPromises ){ this.allPromises = [] }
  this.allPromises.push( promise)
  return promise.then( success, failure, progress)
}

function Promise(){
// Promise/A compliant. See https://gist.github.com/3889970
  this.successBlock  = null
  this.failureBlock  = null
  this.progressBlock = null
  this.nextPromise   = null
  return this
}
Promise.prototype = Promise

Promise.then = function promise_then( success, failure, progress ){
  this.successBlock  = success
  this.failureBlock  = failure
  this.progressBlock = progress
  return this.nextPromise = new Promise()
}

Promise.resolve = function promise_resolve(){
  L8.nextTick( function(){
    if( this.successBlock ){
      try{
        var val = this.successBlock.apply( this, arguments)
        if( this.nextPromise ){
          this.nextPromise.resolve( val)
        }
      }catch( e ){
        if( this.nextPromise ){
          this.nextPromise.reject( e)
        }
      }
    }else if( this.nextPromise ){
      this.resolve.apply( this.nextPromise, arguments)
    }
  })
  return this
}

Promise.reject = function promise_reject(){
  L8.nextTick( function(){
    if( this.failureBlock ){
      try{
        var val = this.failureBlock.apply( this, arguments)
        if( this.nextPromise ){
          this.nextPromise.resolve( val)
        }
      }catch( e ){
        if( this.nextPromise ){
          this.nextPromise.reject( e)
        }
      }
    }else if( this.nextPromise ){
      this.reject.apply( this.nextPromise, arguments)
    }
  })
  return this
}

Promise.progress = function promise_progress(){
  if( this.progressBlock ){
    try{
      this.progressBlock.apply( this, arguments)
    }catch( e ){}
  }
  return this
}

Task.promise = function task_promise(){
  return new Promise()
}

Task.sleep = function sleep( delay ){
  var task = this.current
  var step = task.currentStep
  if( step.isBlocking ){
    throw new Error( "Can't sleep, already blocked l8 task")
  }
  step.isBlocking = true
  setTimeout( function() {
    if( !task.currentStep === step )return
    step.isBlocking = false
    step.scheduleNext()
    L8.scheduler()
  }, delay)
  return task
}

L8.startup = function(){

}

function tests(){

  var test

  var traces = []
  function t(){
    if( traces.length > 200 ){
      trace( "!!! Too many traces, infinite loop? exiting...")
      process.exit( 1)
    }
    var buf = ["test" + (test ? " " + test : ""), "" + CurrentStep]
    for( var ii = 0 ; ii < arguments.length ; ii++ ) buf.push( arguments[ii])
    buf = trace.apply( this, buf)
    traces.push( buf)
    return buf
  }
  function check(){
    var ii = 0
    var msg
    var tt = 0
    var tmsg
    while( ii < arguments.length ){
      msg = arguments[ii++]
      while( true ){
        tmsg = traces[tt]
        if( tmsg && tmsg.indexOf( msg) >= 0 )break
        if( ++tt >= traces.length ){
          var msg = "FAILED test " + test + ", missing trace: " + msg
          trace( msg)
          for( var jj = 0 ; jj < ii ; jj++ ){
            trace( arguments[jj])
          }
          traces = []
          throw new Error( msg)
        }
      }
    }
    trace( "Test " + test, "PASSED")
    traces = []
  }
  t( "starts")

  var test_1 = function test1(){
    test = 1
    t( "go")
    l8.begin
      .step(  function(){ t( "start")      })
      .step(  function(){ t( "step")       })
      .step(  function(){ t( "sleep")
                          this.sleep( 100)
                          t( "sleeping")   })
      .step(  function(){ t( "sleep done") })
      .final( function(){ t( "final")
        check( "start",
               "step",
               "sleep",
               "sleeping",
               "sleep done",
               "final"
        )
        test_2()
      })
    .end
  }

  var test_2 = L8.Task( function test2(){
    test = 2; this
    .step(  function(){ t( "start")               })
    .step(  function(){ setTimeout( this.next, 0) })
    .step(  function(){ t( "sleep/timeout done")  })
    .final( function(){ t( "final")
      check( "start",
             "sleep/timeout done",
             "final"
      )
      test_3()
    })
  })

  var test_3 = L8.Task( function test3(){
    test = 3; this
    .step(    function(){ t( "start")             })
    .step(    function(){ t( "add step 1"); this
      .step(  function(){   t( "first step")  })
                          t( "add step 2"); this
      .step(  function(){   t( "second step") })  })
    .step(    function(){ t("third & final step") })
    .success( function(){ t("success")            })
    .final(   function(){ t( "final")
      check( "start",
             "success",
             "final"
      )
      test_4()
    })
  })

  var test_4 = L8.Task( function test4(){
    test = 4; this
    .step(    function(){ t( "start")                    })
    .step(    function(){ t( "raise error")
                          throw new Error( "step error") })
    .step(    function(){ t("!!! skipped step")          })
    .failure( function(){ t("error raised", this.error)  })
    .final(   function(){ t( "final")
      check( "start",
             "error raised",
             "final"
      )
      test_5()
    })
  })

  var test_5 = L8.Task( function test5(){
    test = 5; this.label = t( "start"); this
    .fork(    function(){ this.label = t( "fork 1"); this
      .step(  function(){ this.sleep( 10)       })
      .step(  function(){ t( "end fork 1")      })        })
    .fork(    function(){ this.label = t( "fork 2"); this
      .step(  function(){ this.sleep( 5)        })
      .step(  function(){ t( "end fork 2")      })        })
    .step(    function(){ t( "joined")          })
    .fork(    function(){ this.label = t( "fork 3"); this
      .step(  function(){ this.sleep( 1)        })
      .final( function(){ t( "final of fork 3") })        })
    .fork(    function(){ this.label = t( "fork 4"); this
      .final( function(){ t( "final of fork 4") })        })
    .step(    function(){ t( "joined again") })
    .final(   function(){ t( "final")
      check( "start",
             "fork 1",
             "fork 2",
             "end fork 2",
             "end fork 1",
             "joined",
             "fork 3",
             "fork 4",
             "final of fork 4",
             "final of fork 3",
             "joined again",
             "final"
      )
      test_6()
    })
  })

  var test_6 = L8.Task( function test6(){
    function other1(){ l8.step( function(){ t( "in other1")} )}
    function other2(){ l8.fork( function(){ t( "in other2")} )}
    test = 6; this
    .step(  function(){ other1(); t( "other1() called")        })
    .step(  function(){ t( "other1 result", this.result); this
                        other2(); t( "other2() called")        })
    .step(  function(){ t( "other2 result", this.result)       })
    .final( function(){ t( "final result", this.result)
      check( "other1() called",
             "in other1",
             "other1 result",
             "other2() called",
             "in other2",
             "other2 result",
             "final result"
      )
      test_7()
    })
  })

  var test_7 = L8.Task( function test7(){
    test = 7
    var ii; this
    .step(   function(){ t( "simple, times", ii = 3)     })
    .repeat( function(){ t( "repeat simple step", ii)
                         if( --ii === 0 ){
                           t( "break simple repeat")
                           this.break
                         }                               })
    .step(   function(){ t( "simple repeat done")        })
    .step(   function(){ t( "sleep, times", ii = 2)      })
    .repeat( function(){ this
      .step( function(){   t( "repeat sleep", ii)
                           this.sleep( 1)                })
      .step( function(){   t( "done sleep", ii)          })
      .step( function(){   if( --ii === 0 ){
                             t( "break sleep repeat")
                             this.break
                           }                          }) })
    .step(   function(){ t( "done ")                     })
    .failure( function( e ){ t( "unexpected failure", e)
                             throw e                      })
    .final(  function(){ t( "final result", this.result)
      check( "simple, times",
             "repeat simple",
             "break simple repeat",
             "simple repeat done",
             "sleep, times",
             "done sleep",
             "break sleep repeat",
             "done",
             "final result"
      )
      test_last()
    })
  })

  var test_last = function(){
    trace( "SUCCESS!!! all tests ok")
  }

  test_1()
  t( "starts scheduler")
  L8.scheduler()
  trace( "L8 scheduler started")
}

trace( "starting L8")
var count_down = 10
setInterval(
  function(){
    trace( "tick " + --count_down)
    if( !count_down ){
      trace( "exiting...")
      process.exit( 0)
    }
  },
  1000
)
tests()

