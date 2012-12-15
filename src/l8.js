// l8.js
//   Task/promise manager
//   https://github.com/JeanHuguesRobert/l8
//
// 2012/10/24, JHR, create
//
// (c) Jean Hugues Robert
// VanityLicense

/* Boiler for module loaders */
(function(define) { 'use strict';
define(function () {

/* ----------------------------------------------------------------------------
 *  Debug
 */

 // DEBUG mode defaults to "on" when nodejs. Please use l8.debug() to change it
 var DEBUG = (typeof window === 'undefined')

var NoOp = function(){}

var TraceStartTask = !DEBUG ? 0 : 0
// When debugging test cases, this tells when to start outputting traces

// In node.js, "util" module defines puts(), among others
var Util = null
try{
  Util = require( "util")
  DEBUG && Util.debug( "entering l8.js")
}catch( e ){}

var trace = function(){
// Print trace. Offer an easy breakpoint when output contains "DEBUG"
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
      try{ debugger }catch( e ){}
    }
  }catch( e ){
    // ToDo: host adapted tracing
  }
  return buf
}

var assert = function( cond ){
  if( !cond ){
    trace.apply( this, arguments)
    trace( "DEBUG assert failure")
    throw new Error( "Assert failure")
  }
}

var de = DEBUG, bug = trace, mand = assert
// That's my de&&bug darling, also de&&mand()


/* ----------------------------------------------------------------------------
 *  Task & Step
 */

var NextTaskId = 0

function Task( parent, is_fork, is_spawn ){
// Tasks are like function call activation records, but with a spaghetti stack
// because more than one child task can be active at the same time.
// See also http://en.wikipedia.org/wiki/Spaghetti_stack
// Forked tasks have parent collect multiple results, one per fork.
// Spawn tasks don't block their parent and don't provide results.
  this.nextFree = void null // Task allocator reuse objects
  task_init.call( this, parent, is_fork, is_spawn)
  return this
}
var ProtoTask = Task.prototype

var task_init =
ProtoTask.init = function( parent, is_fork, is_spawn ){
  this.id               = NextTaskId++ // .toString() uses it
  if( DEBUG ){
    this.stepCount = 0  // Step ids generator
  }
  // Note: initing properties to undefined helps some JIT compilers
  this.firstStep        = void null
  this.isSingleStep     = false
  this.currentStep      = void null // What step the task is on, aka "IP"
  this.insertionStep    = void null // Where steps are usually added
  this.pausedStep       = void null // What step the task is paused on
  this.isFork           = !!is_fork
  this.wasSpawn         = !!is_spawn
  this.stepResult       = void null
  this.stepError        = void null
  this.isDone           = false     // False while task is pending
  this.subtasks         = void null // a set, keys are task.id
  this.subtasksCount    = void null // size of that set
  this.parentTask       = parent    // aka "caller"
  this.forkedTasks      = void null // Subtask(s) that block this task
  this.forkedTasksCount = void null // Number of such tasks
  this.forkResults      = void null // Array of these task's result
  this.forkResultsCount = void null // Number of entries in that array
  this.forkResultsIndex = void null // in parent's forkResults array
  this.optional         = {}        // Some JIT compilers prefer that
  /*
  this.optional.wasCanceled     = false    // "brutal cancel" flag
  this.optional.shouldStop      = false    // "gentle cancel" flag
  this.optional.successBlock    = null
  this.optional.failureBlock    = null
  this.optional.progressBlock   = null
  this.optional.finalBlock      = null
  this.optional.donePromise     = null
  this.optional.generator       = null
  */
  if( TraceStartTask && NextTaskId > TraceStartTask )trace( "DEBUG New", this)

// Add new task to it's parent's list of pending subtasks
  //if( !parent )return this // This is L8, the root task
  // When a done task creates a subtask, the parent task inherit it
  // The root task is obviously never done, or else this would break
  while( parent.isDone ){
    parent = parent.parentTask
  }
  // Parent remembers all pending subtasks, both forked & spawn ones
  if( !parent.subtasks ){
    de&&mand( !parent.subtasksCount, parent.subtasksCount)
    parent.subtasks      = {}
    parent.subtasksCount = 1
  }else{
    parent.subtasksCount++
  }
  parent.subtasks[this.id] = this
  // Forked tasks also block their parent and accumulate results
  if( !is_spawn ){ // && parent != L8 ){
    if( !parent.forkedTasks ){
      parent.forkedTasks      = this
      parent.forkedTasksCount = 1
    }else{
      de&&mand( is_fork || parent === L8 )
      parent.forkedTasksCount++
      if( parent.forkedTasksCount === 2 ){
        parent.forkedTasks = [parent.forkedTasks,this]
      }else{
        parent.forkedTasks.push( this)
      }
    }
    // Allocate entry for forked task result, set to undefined for now
    if( is_fork ){
      if( !parent.forkResults ){
        parent.forkResults      = [void null]
        parent.forkResultsCount = 1
        this.forkResultsIndex = 0 // this task's result in parent.forkResults
      }else{
        parent.forkResults[
          this.forkResultsIndex = parent.forkResultsCount++
        ] = void null
      }
    }
  }
  // Please see what happens in Task.subtaskDoneEvent()
  if( TraceStartTask && NextTaskId > TraceStartTask )trace( "New", this)
  return this
}

function Step( task, block, is_fork, is_repeat ){
// Tasks execute steps, some steps may create additional steps to execute.
// Forked steps run in parallel whereas regular steps are sequential. Steps
// that cannot execute immediatly can block and terminate later when some
// asynchronous event occurs. WHen a forked step is blocked, the other forked
// steps are still executed whereas when a regular step blocks, the next
// steps are blocked too.
  step_init.call( this, task, block, is_fork, is_repeat)
  return this
}
var ProtoStep = Step.prototype

var step_init =
ProtoStep.init = function( task, block, is_fork, is_repeat ){
  if( DEBUG ) this.id = ++task.stepCount
  this.task        = task
  if( block ){
    // If step is a promise, block until that promise delivers
    if( block.then ){
      var promise = block
      block = function(){ this.wait( promise) }
    }
    this.block     = block
  }else{
    this.block     = NoOp
  }
  this.isFork      = is_fork
  this.isRepeat    = is_repeat
  this.wasSpawn    = false
  this.isBlocking  = false   // When task is paused on this step
  // enqueue/dequeue list management
  //this.previous    = null
  this.next        = null
  var previous = task.insertionStep
  task.insertionStep = this
  // When inserting at head
  if( !previous ){
    this.next      = task.firstStep
    //if( this.next ){ this.next.previous = this }
    task.firstStep = task.currentStep = this
  // When inserting at tail
  //}else if( !previous.next ){
    //this.previous      = previous
    //this.previous.next = this
  // When inserting in the middle of the list
  }else{
    //this.previous = previous
    this.next     = previous.next
    //previous.next.previous = this
    previous.next = this
  }
  if( TraceStartTask && NextTaskId > TraceStartTask ){
    trace(
      "New", this,
      this === task.firstStep ? "first" : ""
    )
  }
  return this
}

// Bootstrap root task, id 0
var L8 = new Task( {})
var l8 = L8
L8.parentTask = null
L8.L8 = L8.l8 = L8
var CurrentStep = new Step( L8, NoOp, false, true) // empty loop
CurrentStep.isBlocking = true
L8.currentStep = L8.pausedStep = CurrentStep
L8.timeNow = null
L8.dateNow = null

// Browser & nodejs way to schedule code execution in the event loop.
// Note: you can provide yours if you get an efficient one.
try{
  L8.nextTick = process.nextTick
  L8.nextTick( function(){})
}catch( e ){
  L8.nextTick = function next_tick( block ){ setTimeout( block, 0) }
  L8.nextTick( function(){})
}
var L8_NextTick = L8.nextTick

// Some special errors are used to build control structures
L8.cancelEvent   = "cancel"
L8.breakEvent    = "break"
L8.continueEvent = "continue"
L8.returnEvent   = "return"
L8.failureEvent  = "failure"
L8.closeEvent    = "close"

L8.debug = function( on ){
  if( arguments.length ){
    L8.de = de = DEBUG = on
  }
  return DEBUG
}
L8.debug( DEBUG)


/* ----------------------------------------------------------------------------
 *  Scheduler, aka "step walker"
 *  process.nextTick() or setTimeout() can do the job but I do some buffering
 *  and that runs faster.
 */

var NO_SCHEDULER = false // false && !DEBUG

var L8_Execute // ProtoStep.execute, see below

if( !NO_SCHEDULER ){

var L8_QueuedStep  = null
var L8_StepQueue   = []
var L8_IsScheduled = false

var L8_Tick = function tick(){
  // Update L8.timeNow & L8.dateNow, called often enough.
  // Fast and somehow usefull to correlate traces about the same event.
  // ToDo: Use V8/Mozilla Date.now() ?
  L8.timeNow = (L8.dateNow = new Date()).getTime()
  var step
  var next_step
  while( true ){
    var next_step = L8_StepQueue.shift()
    step = L8_QueuedStep
    if( !step )break
    L8_QueuedStep = next_step
    //step.execute()
    L8_Execute( step)
    L8_IsScheduled = false
  }
  // When done, assume code runs from within the "root" task
  CurrentStep = L8.currentStep
}

var L8_Scheduler = function scheduler(){
// Inject the scheduler in the global event loop.
// It executes queued steps and their next ones.
  if( !L8_IsScheduled ){
    de&&mand( L8_QueuedStep)
    L8_IsScheduled = true
    L8_NextTick( L8_Tick)
  }
}

L8_EnqueueStep = function enqueue_step( step ){
// Schedule step to execute. Restart scheduler if it is not started.
  // Store step, efficiently if only one exist, in an array if more is needed
  if( L8_QueuedStep ){
    L8_StepQueue.push( step)
  }else{
    L8_QueuedStep = step
  }
  de&&mand( !step.isBlocking )
  // Wake up scheduler if necessary, it will eventually execute this step
  if( !L8_IsScheduled ){
    L8_IsScheduled = true
    L8_NextTick( L8_Tick)
  }
  // Debug traces
  if( TraceStartTask && NextTaskId > TraceStartTask ){
    if( L8_QueuedStep ){
      L8_QueuedStep.trace( "queued step")
      var item
      for( var ii = 0 ; ii < L8_StepQueue.length ; ii++ ){
        item = L8_StepQueue[ii].trace( "queued step[" + ii + "]")
      }
    }
  }
}

// when NO_SCHEDULER
}else{

// The code above does the equivalent of this, but it does it faster.
var L8_EnqueueStep = function( step ){
  L8_NextTick(
    // slower: execute.bind( step)
    function(){
      //execute.call( step)
      L8_Execute( step)
      // When done, assume code runs from within the "root" task
      CurrentStep = L8.currentStep
    }
  )
}
L8.__defineGetter__( "timeNow", function(){
  return (L8.dateNow = new Date()).getTime()
})

} // endif !NO_SCHEDULER

ProtoStep.trace = function step_trace( msg ){
  var task = this.task
  trace(
    msg,
    this,
    task.isDone     ? "task done" : "",
    this === task.firstStep ? "first" : "",
    this.isRepeat   ? "repeat" : "",
    this.isFork     ? "fork"   : "",
    this.isBlocking ? "pause"  : ""
  )
}

ProtoStep.execute = L8_Execute = function step_execute( that ){
  if( TraceStartTask && NextTaskId > TraceStartTask ){
    this.trace( "DEBUG execute")
  }
  var task = that.task
  if( DEBUG && task.isDone )throw new Error( "BUG, exec done l8 step: " + that)
  de&&mand( !task.parentTask || task.parentTask.subtasksCount > 0 )
  if( that.isBlocking ){
    de&&mand( task.pausedStep === that )
    return
  }
  task.currentStep = that
  // Steps created by this step are queued after the insertionStep
  task.insertionStep = that
  CurrentStep        = that
  var block = that.block
  var result
  // Consume previous fork results if any unless step is a fork itself
  var results = !that.isFork && task.forkResults
  if( results ){
    de&&mand( !task.forkedTasks )
    task.forkResults      = null
    task.forkResultsCount = 0
  }
  // Execute block, set "this" to the current task
  try{
    // If step(), don't provide any parameter
    if( !block.length ){
      result = block.call( task)
    // If step( r), provide forks results or last result as a single parameter
    }else if( block.length === 1 ){
      if( results ){
        result = block.call( task, results)
      }else{
        result = block.call( task, task.stepResult)
      }
    // If step( a, b, ...), use fork results or assume last result is an array
    }else{
      result = block.apply(
        task,
        (results && results.length > 1)
        ? results
        : task.stepResult
      )
    }
    de&&mand( !task.parentTask || task.parentTask.subtasksCount > 0 )
    // Update last result only when block returned something defined.
    // Result can be set asynchronously using proceed(), see below
    if( result !== void null ){
      task.stepResult = result
      // If result is a promise, block until promise is done
      //if( result.then ){
        //return that.wait( result)
      //}
    }
    if( DEBUG ){ task.progressing() }
  }catch( e ){
    // scheduleNext() will handle the error propagation
    task.stepError = e
    if( DEBUG ){
      that.trace( "task failure: " + e)
      if( TraceStartTask && NextTaskId > TraceStartTask ){
        that.trace( "DEBUG execute failed" + e)
      }
    }
  }
  // task.insertionStep = null
  that.scheduleNext()
}

ProtoStep.scheduleNext = function schedule_next(){
// Handle progression from step to step, error propagation, task termination
  var task = this.task
  if( task.isDone )throw new Error( "Bug, schedule a done l8 task: " + this)
  de&&mand( !task.parentTask || task.parentTask.subtasksCount > 0 )
  if( this.isBlocking ){
    de&&mand( task.pausedStep === this, task.pausedStep)
    return
  }
  var redo = this.isRepeat
  // Handle "continue" and "break" in loops
  if( redo && task.stepError ){
    if( task.stepError === L8.continueEvent ){
      task.stepError = void null
    }else if( task.stepError === L8.breakEvent ){
      redo = false
    }
  }
  // When no error, wait for subtasks if any, else move to next step or loop
  if( !task.stepError ){
    var next_step = redo ? this : this.next
    if( next_step ){
      if( !this.isFork || !next_step.isFork || redo ){
        // Regular steps wait for forked tasks, fork steps don't
        if( task.forkedTasks ){
          this.isBlocking = true
          task.pausedStep = this
          return
        }
      }
      if( redo ){
        if( task === L8 ){
          this.isBlocking = true
          task.pausedStep = this
          return
        }
      }
      if( NO_SCHEDULER ){
        L8_NextTick( function(){ L8_Execute( next_step) })
      }else{
        L8_EnqueueStep( next_step)
      }
      de&&mand( task.parentTask || task.parentTask.subtasksCount > 0 )
      return
    }else{
      if( task.forkedTasks ){
        this.isBlocking = true
        task.pausedStep = this
        return
      }
    }
  // When error, cancel all remaining subtasks
  }else{
    var subtasks = task.subtasks
    if( subtasks ){
      for( var subtask_id in subtasks ){
        subtasks[subtask_id].cancel()
      }
      de&&mand( !task.parentTask || task.parentTask.subtasksCount > 0 )
    }
    if( task.forkedTasks ){
      this.isBlocking = true
      task.pausedStep = this
      return
    }
  }
  // When nothing more, handle task termination
  de&&mand( !task.forkedTasks )
  this.isBlocking = true
  task.pausedStep = null
  // ToDo: let success/failure block run asynch, then done, not before
  task.isDone     = true
  var exit_repeat = false
  var is_return   = false
  var block
  if( task.stepError === L8.returnEvent ){
    is_return = true
    task.stepError = void null
  }else if( task.stepError === L8.breakEvent ){
    task.stepError = void null
    exit_repeat    = true
  }
  task.progressing()
  var err = task.stepError
  de&&mand( !task.parentTask || task.parentTask.subtasksCount > 0 )
  if( err ){
    if( block = task.optional.failureBlock ){
      try{
        block.call( task, err)
        err = task.stepError = void null
      }catch( e ){
        task.stepError = e
      }
    }
  }else{
    if( block = task.optional.successBlock ){
      try{
        block.call( task, task.stepResult)
      }catch( e ){
        err = task.stepError = e
      }
    }
  }
  if( block = task.optional.finalBlock ){
    try{
      block.call( task, err, task.stepResult)
    }catch( e ){
      err = task.stepError = e
    }
  }
  var promise = task.optional.donePromise
  if( promise ){
    if( err ){
      promise.reject( err)
    }else{
      promise.resolve( task.stepResult)
    }
  }
  var parent = task.parentTask
  if( exit_repeat ){
    //if( parent ){
      if( parent.currentStep.isRepeat ){
        parent.currentStep.isRepeat = false
      }else{
        // task.parentTask.raise( L8.breakEvent)
        task.stepError = L8.breakEvent
      }
    //}
  }else if( is_return && !task.optional.wasCanceled ){
    task.optional.wasCanceled
    task.stepError = L8.returnEvent
  }
  //if( parent ){ // all tasks (but inactive root one) have a parent
    de&&mand( parent.subtasksCount > 0 )
    parent.subtaskDoneEvent( task)
  //}
  task.firstStep.free()
}

ProtoTask.subtaskDoneEvent = function( subtask ){
// Private. Called by Step.scheduleNextStep() when subtask is done
  if( DEBUG && TraceStartTask && NextTaskId > TraceStartTask ){
    trace( "DEBUG Done subtask", subtask)
  }
  // One less pending subtask
  de&&mand( !this.parentTask || this.parentTask.subtasksCount > 0 )
  de&&mand( !subtask.forkedTasks )
  de&&mand( this.subtasksCount > 0, this.subtasksCount)
  de&&mand( this.subtasks)
  de&&mand( this.subtasks[subtask.id] === subtask )
  delete this.subtasks[subtask.id]
  // Some task objects are reuseable. If a reference to the task was held
  // somewhere, using it is when the task is done is a bug
  if( !subtask.wasSpawn ){
    subtask.free()
  }
  // Parent task inherits spawn subtasks, unix does the same with processes
  var list = subtask.subtasks
  if( list ){
    subtask.subtasks      = null
    subtask.subtasksCount = 0
    var item
    for( var ii in list ){
      item = list[ii]
      if( item.subtasks ){
        item.parentTask = this
        this.subtasks[item.id] = item
        this.subtasksCount++
      }
    }
  }
  if( --this.subtasksCount === 0 ){
    this.subtasks = null
  }
  // When a fork is done, resume blocked parent and remember result
  if( !subtask.wasSpawn ){ // && this.parentTast ){
    // When a forked task fails, parent will cancel the other forks
    var err = subtask.stepError
    if( err ){
      this.stepError = err
    }else if( subtask.isFork ){
      this.forkResults[subtask.forkResultsIndex] = subtask.stepResult
    }
    // When all forks succeed, resume blocked parent task
    // Ditto if one fork fails
    if( --this.forkedTasksCount <= 0 || err ){
      // Clear this.forkedTasks when it is empty, code elsewhere expect this
      if( !this.forkedTasksCount ){
        this.forkedTasks = null
      }
      // As a bonus, deblocking task's result is made available for next step
      if( !err ){ this.stepResult = subtask.stepResult }
      // Unless fork terminated early there should be blocked steps
      var paused_step = this.pausedStep
      if( paused_step && this !== L8 ){
        de&&mand( paused_step.task === this )
        paused_step.isBlocking = false
        this.pausedStep = null
        paused_step.scheduleNext()
      // But if task has no more steps, make task result using forked results
      }else if( subtask.isFork ){
        var list = this.forkedTasksResults
        var len  = list ? this.forkedTasksResults.length : 0
        // ToDo: I need a isTask flag to handle length 1 result lists
        if( list && len > 1 ){
          var buf  = []
          var item
          for( var ii = 0 ; ii < len ; ii++ ){
            item = list[ii]
            if( !item.stepError ){
              buf.push( item.stepResult)
            }else{
              buf.push( void null)
            }
          }
          this.stepResult = buf
        }
      }
    }
  }
}

ProtoTask.step = function step( block, is_fork, is_repeat ){
// Add a step to execute later
  var task = this.current
  if( task.isDone )throw new Error( "Cannot add new step, l8 task is done")
  if( !(block instanceof Function) ){
    block = function(){ task.interpret( block) }
  }
  MakeStep( task, block, is_fork, is_repeat)
  return task
}

ProtoTask.proceed = function( block ){
  var task = this.current
  var step = task.currentStep
  if( step.isBlocking ){
    // ToDo: test/allow multiple next()
    // throw new Error( "Can't walk, not running")
  }
  step.isBlocking = true
  task.pausedStep = step
  return function walk_cb(){
    if( task.currentStep !== step ){
      // ToDo: quid if multiple proceed() fire?
      throw new Error( "Cannot walk same step again")
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
          de&&mand( task.pausedStep === step )
          task.stepResult = result
          // If result is a promise, wait for it
          if( result.then ){
            task.wait( result)
          // Else, resume task
          }else{
            step.isBlocking = false
            task.pausedStep = null
            step.scheduleNext()
          }
        }
      }
    }catch( e ){
      task.raise( e)
    }finally{
      CurrentStep = previous_step
      //L8_Scheduler()
    }
  }
}

ProtoTask.__defineGetter__( "walk", function(){
  return this.proceed( null)
})


/*
 *  Step allocator. Attempt to reuse some previous steps.
 */

var NextFreeStep = null

function MakeStep( task, block, is_fork, is_repeat ){
  var step = NextFreeStep
  if( step ){
    NextFreeStep = step.next
    return step_init.call( step, task, block, is_fork, is_repeat)
  }
  return new Step( task, block, is_fork, is_repeat)
}

ProtoStep.free = function(){
  if( NextFreeStep ){
    this.next = NextFreeStep
  }
  NextFreeStep = this
}

/*
 *  Task allocator. Attempt to reuse some previous task objects.
 */

var NextFreeTask = null

function MakeTask( parent, is_fork, is_spawn ){
  var task = NextFreeTask
  if( task ){
    NextFreeTask = task.nextFree
    return task_init.call( task, parent, is_fork, is_spawn)
  }
  return new Task( parent, is_fork, is_spawn)
}

ProtoTask.free = function(){
  this.nextFree = NextFreeTask
  NextFreeTask = this
}

/* ----------------------------------------------------------------------------
 *  API
 */

ProtoTask.Task = function task_task( fn ){
// Build a "task constructor". When such a beast is called, it creates a task
  if( !(fn instanceof Function) ){
    var block
    if( !(fn instanceof Array) || arguments.length > 1 ){
      block = Array.prototype.slice.call( arguments, 0)
    }else{
      block = fn
    }
    fn = function(){ this.interpret( block) }
  }
  return function (){
    var parent_task = CurrentStep.task.isDone ? L8 : CurrentStep.task
    var args = arguments
    // Don't create a useless task if parent task is still a "single step" task
    if( parent_task.isSingleStep && !parent_task.firstStep.next ){
      MakeStep( parent_task, function(){ return fn.apply( task, args) })
      return parent_task
    }
    var task = MakeTask( parent_task)
    var next_step = MakeStep( task, function(){ return fn.apply( task, args) })
    if( NO_SCHEDULER ){
      L8_NextTick( function(){ L8_Execute( next_step) })
    }else{
      L8_EnqueueStep( next_step)
    }
    return task
  }
}

ProtoTask.toString = function task_to_string(){ return "Task " + this.id }

ProtoTask.__defineGetter__( "current", function(){
  return this === L8 ? CurrentStep.task : this
})

ProtoTask.__defineGetter__( "begin", function(){
  return MakeTask( this.current)
})

ProtoTask.__defineGetter__( "end", function(){
  var task  = this
  var first = task.firstStep
  var is_new_step = false
  if( !first ){
    is_new_step
    first = MakeStep( task)
  }
  // When first step can run immediately
  if( !task.forkedTasks ){
    L8_EnqueueStep( first)
  // When first step is after forks
  }else{
    // Pause task to wait for forks, need a new "first step" for that
    if( !is_new_step ){
      var save = task.insertionStep
      // Insert at head of list of steps
      task.insertionStep = null
      MakeStep( task)
      task.insertionStep = save
    }
    task.pausedStep = task.firstStep
    task.pausedStep.isBlocking = true
  }
  // Return parent, makes chaining possible t.begin.step().step().end.step()
  return task.parentTask
})

ProtoTask.__defineGetter__( "done", function(){
  return this.current.isDone
})

ProtoTask.__defineGetter__( "succeed", function(){
  var task = this.current
  return task.isDone && !task.err
})

ProtoTask.__defineGetter__( "fail", function(){
  var task = this.current
  return task.isDone && task.err
})

ProtoTask.__defineGetter__( "result", function(){
  return this.current.stepResult
})

ProtoTask.__defineSetter__( "result", function( val){
  return this.current.stepResult = val
})

ProtoTask.__defineGetter__( "error", function(){
  return this.current.stepError
})

ProtoTask.__defineGetter__( "stop", function(){
  var task = this.current
  task.optional.shouldStop = true
  return task
})

ProtoTask.__defineGetter__( "stopping", function(){
  var task = this.current
  return task.optional.shouldStop && !task.isDone
})

ProtoTask.__defineGetter__( "stopped", function(){
  var task = this.current
  return task.optional.shouldStop && task.isDone
})

ProtoTask.__defineGetter__( "canceled", function(){
  return this.current.optional.wasCanceled
})

ProtoTask.task = function task_task( block, forked, paused, detached, repeat ){
// Add a step that will start a new task with some initial step to execute.
// Such tasks are initially "single step" task. If the single step calls a
// task constructor, that constructor will get optimized and will reuse the
// single step task instead of creating a new task.
  if( TraceStartTask && NextTaskId > TraceStartTask ){
    trace( this.current.currentStep , "invokes fork()",
      forked   ? "forked"   : "",
      paused   ? "paused"   : "",
      detached ? "detached" : "",
      repeat   ? "repeated" : ""
    )
  }
  return this.step( function(){
    var task = this.current
    if( TraceStartTask && TraceStartTask >= NextTaskId ){
      trace( task.currentStep , "executes scheduled fork",
        forked   ? "forked"   : "",
        paused   ? "paused"   : "",
        detached ? "detached" : "",
        repeat   ? "repeated" : ""
      )
    }
    var new_task = MakeTask( task, forked, detached)
    // Mark as reuseable, unless spawn
    new_task.wasSpawn     = detached
    new_task.isSingleStep = true
    if( paused ){
      // Pause task, need a new "first step" for that
      MakeStep( new_task)
      new_task.pausedStep = new_task.firstStep
      new_task.pausedStep.isBlocking = true
      MakeStep( new_task, block)
    }else{
      var next_step = MakeStep( new_task, block)
      if( NO_SCHEDULER ){
        L8_NextTick( function(){ L8_Execute( next_step) })
      }else{
        L8_EnqueueStep( next_step)
      }
    }
  }, forked, repeat)
}

ProtoTask.fork = function task_fork( block, starts_paused ){
// Add a step that will start a forked task with some initial step to execute
  return this.task( block, true, starts_paused)
}

ProtoTask.spawn = function task_spawn( block, starts_paused ){
// Add a step that will start a detached task with some initial step to execute
  return this.task( block, true, starts_paused, true) // detached
}

ProtoTask.repeat = function task_repeat( block ){
// Add a step that will repeately start a new task with a first step to execute
  return this.task( block, false, false, false, true) // repeated
}

ProtoTask.interpret = function task_interpret( steps ){
// Add steps according to description.
  var task = this.current
  if( steps.then ){
    this.step( function(){ this.wait( steps) })
    return task
  }
  var block
  for( step in steps ){
    if( step instanceof Function ){
      this.step( step)
    }else if( step instanceof Array ){
      this.task( step)
    }else if( step.then ){
      (function( promise ){ this.step( function(){ this.wait( promise) }) })
      ( step)
    }else{
      if( block = step.step     ){ this.step(     block) }
      if( block = step.task     ){ this.task(     block) }
      if( block = step.repeat   ){ this.repeat(   block) }
      if( block = step.fork     ){ this.fork(     block) }
      if( block = step.progress ){ this.progress( block) }
      if( block = step.success  ){ this.success(  block) }
      if( block = step.failure  ){ this.failure(  block) }
      if( block = step.final    ){ this.final(    block) }
    }
  }
  return task
}

ProtoTask.__defineGetter__( "tasks", function(){
  var buf = []
  var tasks = this.subTasks
  if( tasks ){
    for( var k in tasks ){
      buf.push( tasks[k])
    }
  }
  return buf
})

ProtoTask.__defineGetter__( "parent", function(){
  return this.current.parentTask
})

ProtoTask.__defineGetter__( "root", function(){
  var task = this.current
  if( !task.parentTask )return task
  while( true ){
    if( task.parentTask === L8 )return task
    task = task.parentTask
  }
})

ProtoTask.__defineGetter__( "paused", function(){
  var task = this.current
  return !!task.pausedStep
})

ProtoTask.cancel = function task_cancel(){
  var task    = this.current
  if( task.isDone )return task
  var done    = false
  var on_self = false
  while( !done ){
    done = true
    var tasks = task.tasks
    for( var subtask in tasks ){
      if( subtask.optional.wasCanceled )continue
      if( subtask.currentStep === CurrentStep ){
        on_self = subtask
      }else{
        done = false
        subtask.cancel()
      }
    }
  }
  if( !on_self && task !== CurrentStep.task ){
    task.optional.wasCanceled = true
    task.raise( L8.cancelEvent)
  }
  return task
}

ProtoTask.progressing = function task_progressing(){
  if( this.optional.progressBlock ){
    try{
      this.optional.progressBlock( this)
    }catch( e ){
      // ToDo
    }
  }
  if( this.optional.promise ){
    this.promise.progress()
  }
}

ProtoTask.return = function task_return( val ){
  var task = this.current
  if( task.isDone ){
    throw new Error( "Cannot return(), done l8 task")
  }
  if( val ){ task.stepResult = val }
  task.optional.wasCanceled = true
  task.raise( L8.returnEvent, val)
}
ProtoTask.__defineGetter__( "continue", function task_continue(){
  return this.raise( L8.continueEvent)
})

ProtoTask.__defineGetter__( "break",  function task_break(){
  return this.raise( L8.breakEvent)
})

ProtoStep.toString = function(){ return this.task.toString() + "/" + this.id }

ProtoTask.final = function final( block ){
  var task = this.current
  task.optional.finalBlock = block
  return task
}

ProtoTask.finally = Task.final

ProtoTask.failure = function failure( block ){
  var task = this.current
  task.optional.failureBlock = block
  return task
}

ProtoTask.catch = Task.failure

ProtoTask.success = function success( block ){
  var task = this.current
  task.optional.successBlock = block
  return task
}

/* ----------------------------------------------------------------------------
 *  Trans-compiler
 */

ProtoTask.compile = function task_compile( code, generator ){
// Expand some macros to make a "task constructor" or a generator constructor.

  // Lexer

  code = code.toString()
  var close = code.lastIndexOf( "}")
  code = code.substr( 0, close) + code.substr( close + 1)
  code = "\n begin;\n" + code + "\n end;\n"
  var ii = 0
  var fragment
  var fragments = []
  code.replace(
    / (begin|end|step;|step\([^\)]*\);|task;|task\([^\)]*\);|fork;|fork\([^\)]*\);|repeat;|repeat\([^\)]*\);|progress;|progress\([^\)]*\);|success;|success\([^\)]*\);|failure;|failure\([^\)]*\);|final;|final\([^\)]*\);)/g,
    function( match, keyword, index ){
      fragment = code.substring( ii, index - 1)
      fragments.push( fragment)
      fragment = "~kw~" + keyword
      fragments.push( fragment)
      ii = index + match.length
    }
  )

  // Parser

  function is_empty( code ){
    return !code
    .replace( /;/g,  "")
    .replace( /\./g, "")
    .replace( /\s/g, "")
    .replace( /\r/g, "")
    .replace( /\n/g, "")
  }

  function parse( list, subtree, is_nested ){
    var obj
    var kw
    var params
    if( !list.length )return subtree
    var head = list.shift()
    // trace( head)
    if( head == "~kw~end" ){
      if( !is_nested ){
        throw new Error( "Unexpected 'end' in L8.compile()")
      }
      return subtree
    }
    if( head == "~kw~begin" ){
      var sub = parse( list, [], true)
      subtree.push( {begin: sub})
    }else if( head.indexOf( "~kw~") === 0 ){
      kw = head.substr( 4).replace( ";", "").replace( /\s/g, "")
      params = ""
      kw = kw.replace( /\(.*\)/, function( match ){
        params = match
        return ""
      })
      obj = {params:params}
      obj[kw] = list.shift()
      subtree.push( obj)
    }else{
      subtree.push( {code:head})
    }
    return parse( list, subtree, is_nested)
  }

  var tree = parse( fragments, [], false)
  var body = tree[1].begin
  var head = body[0].code.replace( /;\nfunction/, "function")
  delete body[0]

  // Code generator

  var pushed

  function f( params, code ){
    params = params || "()"
    return "function" + params + "{ "
    + code.replace( / +/g, " ").replace( /(\r|\n| )+$/, "")
    + " }"
  }

  function g( buf, kw, params, code ){
    if( is_empty( code) ){
      pushed = true
      return ""
    }
    //buf.push( "this." + kw + "( " + f( code) + ");\n")
    buf.push( kw + "( " + f( params, code) + ")")
    pushed = true
  }

  var previous = null

  function gen_block( head, buf, after ){
    if( !head )return
    var block
    if( block = head.begin ){
      var body_obj = []
      previous = null
      generate( block, body_obj)
      body_obj = body_obj.join( ".\n")
      if( after && (after.fork || after.repeat || after.spawn) ){
        buf.push( body_obj)
        pushed = true
        return
      }
      // "begin" after "step" is equivalent to "task"
      if( after && after.step ){
        buf.push( body_obj)
        pushed = true
        return
      }
      g( buf, "task", "()", body_obj)
    }
    else if( block = head.code     ){
      if( !is_empty( block) ){
        buf.push( block + "\nthis")
      }
      pushed = true
    }
    else if( block = head.step     ){ g( buf, "step",     head.params, block) }
    else if( block = head.task     ){ g( buf, "task",     head.params, block) }
    else if( block = head.fork     ){ g( buf, "fork",     head.params, block) }
    else if( block = head.spawn    ){ g( buf, "spawn",    head.params, block) }
    else if( block = head.repeat   ){ g( buf, "repeat",   head.params, block) }
    else if( block = head.progress ){ g( buf, "progress", head.params, block) }
    else if( block = head.success  ){ g( buf, "success",  head.params, block) }
    else if( block = head.failure  ){ g( buf, "failure",  head.params, block) }
    else if( block = head.final    ){ g( buf, "final",    head.params, block) }
  }

  function generate( tree, buf ){
    if( !tree.length ){
      gen_block( previous, buf)
      return
    }
    var head = tree.shift()
    if( !head )return generate( tree, buf)
    var block
    pushed = false
    if( head.begin && previous ){
      var content
      for( var kw in previous ){
        if( kw == "params" )continue
        content = previous[kw]
      }
      if( is_empty( content) ){
        content = []
        var tmp = previous
        gen_block( head, content, previous)
        previous = tmp
        for( kw in previous ){
          if( kw == "params" )continue
          // "step" + "begin" eqv "task"
          if( kw == "step" ){
            previous["step"] = null
            kw = "task"
          }
          previous[kw] = content.join( ".\n")
        }
        head = null
      }
    }
    if( previous ){
      gen_block( previous, buf)
      if( !pushed ){
        //g( buf, "step", previous.code)
        if( !is_empty( previous.code) ){
          buf.push( previous.code  + ";this")
        }
        pushed = true
      }
    }
    previous = head
    generate( tree, buf)
  }

  //trace( Util.inspect( fragments))
  var str  = []
  str.push( head + ";this")
  generate( body, str)
  // trace( Util.inspect( str))
  str = str.join( ".\n") + "}"
  var fn
  eval( "fn = " + str)
  return !generator ? L8.Task( fn) : L8.Generator( fn)
}

L8.compileGenerator = function( code ){
  return L8.compile( code, true)
}

if( DEBUG ){
var do_something_as_task = function(){
    var ii = 0
    step; this.sleep( 1000);
    fork; do_some_other_task();
    fork; another_task();
    task; yet();
    step( a, b ); use( a); use( b);
    step; begin
      ii++
      step; ha()
    end
    fork; begin
      first()
      failure; bad()
    end
    fork; begin
      step; second()
      failure; very_bad()
    end
    begin
      step; ok()
      failure; ko()
    end
    repeat; begin
      step; act()
      step( r ); if( !r ) this.break
    end
    success; done();
    failure; problem();
    final;   always();
}
trace( L8.compile( do_something_as_task))
} // DEBUG

/* ----------------------------------------------------------------------------
 *  Promise
 */

function Promise(){
// Promise/A compliant. See https://gist.github.com/3889970
  this.wasResolved  = false
  this.resolveValue = void null
  this.wasRejected  = false
  this.rejectReason = void null
  this.allHandlers  = null
  return this
}
var ProtoPromise = Promise.prototype

var P_defer = null // q.js or when.js 's defer(), or angular's $q's one

L8.setPromiseFactory = function( factory ){
  P = factory
}

function MakePromise(){
  return P_defer ? P_defer() : new Promise()
}

ProtoTask.__defineGetter__( "promise", function task_promise(){
  return MakePromise()
})

ProtoTask.then = function task_then( success, failure, progress ){
  var promise = this.optional.donePromise
  if( !promise ){
    promise = this.optional.donePromise = MakePromise()
  }
  return promise.then( success, failure, progress)
}

ProtoPromise.then = function promise_then( success, failure, progress ){
  var new_promise = MakePromise()
  if( !this.allHandlers ){
    this.allHandlers = []
  }
  this.allHandlers.push({
    successBlock:  success,
    failureBlock:  failure,
    progressBlock: progress,
    nextPromise:   new_promise
  })
  if( this.wasResolved ){
    this.resolve( this.resolveValue, true) // force
  }else if( this.wasRejected ){
    this.reject( this.rejectReason, true)  // force
  }
  return new_promise
}

ProtoPromise.handleResult =  function handle( handler, ok, value ){
  var block = ok ? handler.successBlock : handler.failureBlock
  var next  = handler.nextPromise
  if( block ){
    try{
      var val = block.call( this, value)
      if( val && val.then ){
        val.then(
          function( r ){ ProtoPromise.handleResult( handler, true,  r) },
          function( e ){ ProtoPromise.handleResult( handler, false, e) }
        )
        return
      }
      if( next ){
        next.resolve( val)
      }
    }catch( e ){
      if( next ){
        next.reject( e)
      }
    }
  }else if( next ){
    next.resolve.call( next, value)
  }
  handler.nextPromise = null
  handler.failureBlock = handler.successBlock = handler.progressBlock = null
}

ProtoPromise.resolve = function promise_resolve( value, force ){
  if( !force && (this.wasResolved || this.wasRejected) )return
  this.wasResolved  = true
  this.resolveValue = value
  if( !this.allHandlers )return
  function handle( handler, value ){
    L8_NextTick( function(){
      ProtoPromise.handleResult( handler, true, value)
    })
  }
  for( var ii = 0 ; ii < this.allHandlers.length ; ii++ ){
    handle( this.allHandlers[ii], value)
  }
  this.allHandlers = null
  return this
}

ProtoPromise.reject = function promise_reject( value, force ){
  if( !force && (this.wasResolved || this.wasRejected) )return
  this.wasRejected  = true
  this.rejectReason = value
  if( !this.allHandlers )return
  function handle( handler, value ){
    L8_NextTick( function(){
      ProtoPromise.handleResult( handler, false, value)
    })
  }
  for( var ii = 0 ; ii < this.allHandlers.length ; ii++ ){
    handle( this.allHandlers[ii], value)
  }
  this.allHandlers = null
  return this
}

ProtoPromise.progress = function promise_progress(){
  if( this.wasResolved || this.wasRejected )return
  // ToDo: implement this
  return this
}

/* ----------------------------------------------------------------------------
 *  Tasks synchronization
 */

ProtoTask.wait = function task_wait( promise ){
  var task = this.current
  var step = task.currentStep
  task.pause()
  promise.then(
    function( r ){
      if( !task.currentStep === step )return
      task.resume()
    },
    function( e ){
      if( !task.currentStep === step )return
      task.raise( e)
    }
  )
  return task
}

ProtoTask.pause = function pause(){
// Pause execution of task at current step. Task will resume and execute next
// step when resume() is called.
  var task = this.current
  var step = task.currentStep
  if( step.isBlocking ){
    throw new Error( "Cannot pause, already blocked l8 task")
  }
  step.isBlocking = true
  task.pausedStep = step
  return task
}

ProtoTask.resume = function task_resume(){
// Resume execution of paused task. Execution restarts at step next to the
// one where the task was paused.
  var task = this.current
  if( task.isDone ){
    throw new Error( "Cannot resume, done l8 task")
  }
  var paused_step = task.pausedStep
  if( !paused_step ){
    throw new Error( "Cannot resume, not paused l8 task")
  }
  if( !paused_step.isBlocking ){
    throw new Error( "Cannot resume, running l8 step")
  }
  de&&mand( paused_step.task === this )
  task.pausedStep = null
  paused_step.isBlocking = false
  paused_step.scheduleNext()
  return task
}

ProtoTask.raise = function task_raise( err, val ){
  var task = this.current
  if( task.isDone )return task
  err = task.stepError = err || task.stepError || L8.failureEvent
  if( val ){ task.stepResult = val }
  var step = task.currentStep
  if( step ){
    // If there exists subtasks, forward error to them
    var queue =  task.forkedTasks
    if( queue ){
      if( queue instanceof Array ){
        for( var subtask in queue ){
          queue[subtask].raise( err)
        }
      }else{
        queue.raise( err, val)
      }
      return
    }
    // error are forwarded to parent, unless catched, in scheduleNext()
    if( step.isBlocking ){
      step.isBlocking = false
      task.pauseStep  = null
      step.scheduleNext()
    }else if( step === CurrentStep ){
      throw err
    }
  }else{
    de&&bug( "Unhandled exception", err, err.stack)
  }
  return task
}

ProtoTask.throw = Task.raise

ProtoTask.sleep = function task_sleep( delay ){
  var task = this.current
  var step = task.currentStep
  task.pause()
  setTimeout( function() {
    if( !task.currentStep === step )return
    task.resume()
  }, delay)
  return task
}

/* ----------------------------------------------------------------------------
 *  Semaphore
 */

function Semaphore( count ){
  this.count        = count
  this.promiseQueue = []
  this.closed       = false
  return this
}
var ProtoSemaphore = Semaphore.prototype

ProtoTask.semaphore = function( count ){
  return new Semaphore( count)
}

ProtoSemaphore.then = function( callback ){
  return this.promise.then( callback)
}

ProtoSemaphore.__defineGetter__( "promise", function(){
  var promise = MakePromise()
  if( this.closed ){
    promise.reject( L8.CloseEvent)
    return
  }
  if( this.count > 0 ){
    this.count--
    promise.resolve( this)
  }else{
    this.queue.push( promise)
  }
  return promise
})

ProtoSemaphore.release = function(){
  this.count++
  if( this.closed || this.count <= 0 )return
  var step = this.promiseQueue.shift()
  if( step ){
    this.count--
    step.resolve( this)
  }
  return this
}

ProtoSemaphore.close = function(){
  var list = this.promiseQueue
  this.promiseQueue = null
  var len = list.length
  for( var ii = 0 ; ii < len ; ii++ ){
    list[ii].reject( L8.CloseEvent)
  }
  return this
}

/* ----------------------------------------------------------------------------
 *  Mutex
 */

function Mutex( entered ){
  this.entered   = entered
  this.task      = null
  this.taskQueue = []
  this.closed    = false
}
var ProtoMutex = Mutex.prototype

ProtoTask.mutex = function task_mutex( entered ){
  return new Mutex( entered)
}

ProtoMutex.__defineGetter__( "promise", function(){
  var promise = MakePromise()
  var task = CurrentStep.task
  // when no need to queue...
  if( !this.entered || this.task === task ){
    // ... because same task cannot block itself
    if( this.entered ){
      promise.reject( new Error( "mutex already entered"))
    // ... because nobody's there
    }else{
      this.entered = true
      this.task    = task
      promise.resolve( this)
    }
  // when a new task wants to enter asap
  }else{
    this.queue.push( promise)
  }
  return promise
})

ProtoMutex.then = function( callback, errback ){
// Duck typing so that Task.wait() works
  return this.promise.then( callback, errback)
}

ProtoMutex.release = function(){
  if( !this.entered )return
  this.task = null
  var promise = this.promiseQueue.shift()
  if( promise ){
    promise.resolve( this)
  }else{
    this.entered = false
    this.task    = null
  }
}

ProtoMutex.close = function(){
  var list = this.promiseQueue
  this.promiseQueue = null
  var len = list.length
  for( var ii = 0 ; ii < len ; ii++ ){
    list[ii].reject( L8.CloseEvent)
  }
  return this
}

/* ----------------------------------------------------------------------------
 *  Lock
 */

function Lock( count ){
// aka "reentrant mutex"
  this.mutex  = new Mutex( count > 0 )
  this.count  = count || 0
  this.closed = false
}
var ProtoLock = Lock.prototype

ProtoTask.lock = function task_lock( count ){
  return new Lock( count)
}

ProtoLock.__defineGetter__( "promise", function(){
  var that    = this
  var promise = MakePromise()
  if( this.mutex.task === CurrentStep.task ){
    this.count++
    promise.resolve( that)
  }else{
    this.mutex.then( function(){
      this.count = 1
      promise.resolve( that)
    })
  }
  return promise
})

ProtoLock.then = function lock_then( callback, errback ){
  return this.promise.then( callback, errback)
}

ProtoLock.release = function(){
  if( this.count ){
    if( --this.count )return
  }
  this.mutex.release()
}

ProtoLock.__defineGetter__( "task", function(){
  return this.mutex.task
})

ProtoLock.close = function(){
  if( this.closed )return
  this.closed = true
  this.mutex.close()
  return this
}

/* ----------------------------------------------------------------------------
 *  Port. Producer/Consumer protocol with no buffering at all.
 */

function Port(){
  this.getPromise = null // "in"  promise, ready when ready to .get()
  this.putPromise = null // "out" promise, ready when ready to .put()
  this.value      = null
  this.closed     = false
}
var ProtoPort = Port.prototype

ProtoTask.port = function task_port(){
  return new Port()
}

ProtoPort.__defineGetter__( "promise", function(){
  return this.in
})

ProtoPort.then = function port_then( callback, errback ){
  return this.in.then( callback, errback)
}

ProtoPort.get = function port_get(){
  var that = this
  this.out.resolve()
  var task = this.current
  var step = task.currentStep
  task.pause()
  this.in.then( function( r ){
    if( !that.getPromise )return that.in
    that.getPromise = null
    that.value = r
    if( task.pausedStep === step ){
      task.resume()
      task.stepResult = r
    }
  })
  return this
}

ProtoPort.tryGet = function(){
// Like .get() but non blocking
  if( this.closed
  || !this.getPromise
  || this.getPromise.wasResolved
  )return [false]
  this.getPromise = null
  return [true, this.value]
}

ProtoPort.put = function port_put( msg ){
  var that = this
  this.in.resolve( msg)
  var task = this.current
  var step = task.currentStep
  task.pause()
  this.out.then( function(){
    if( !that.putPromise )return that.out
    that.putPromise = null
    if( task.pausedStep === step ){
      task.resume()
    }
  })
  return this
}

ProtoPort.tryPut = function( msg ){
// Like .put() but non blocking
  if( this.closed
  ||  !this.putPromise
  ||  !this.putPromise.wasResolved
  )return false
  this.putPromise = null
  this.value = msg
  return true
}

ProtoPort.__defineGetter__( "in", function(){
  return this.getPromise
  ? this.getPromise = MakePromise()
  : this.getPromise
})

ProtoPort.__defineGetter__( "out", function(){
  return this.putPromise
  ? this.putPromise = MakePromise()
  : this.putPromise
})

/* ----------------------------------------------------------------------------
 *  MessageQueue. Producer/Consumer protocol with buffering.
 */

function MessageQueue( capacity ){
  this.capacity   = capacity || 1
  this.queue      = new Array( this.capacity)
  this.length     = 0
  this.getPromise = null // "in"  promise, ready when ready to .get()
  this.putPromise = null // "out" promise, ready when ready to .put()
  this.closed     = false
}
var ProtoMessageQueue = MessageQueue.prototype

ProtoTask.queue = function task_queue( capacity ){
  return new MessageQueue( capacity)
}

ProtoMessageQueue.__defineGetter__( "promise", function(){
  return this.in
})

ProtoMessageQueue.then = function message_queue_then( callback, errback ){
  return this.in.then( callback, errback)
}

ProtoMessageQueue.put = function message_queue_put( msg ){
  var that = this
  var task = CurrentStep.task
  if( this.full ){
    task.pause()
    this.out.then( function(){
      task.queue.push( msg)
      task.resume()
      that.in.resolve()
      ++that.length
      if( !that.full ){
        that.out.resolve()
      }
    })
  }else{
    this.queue.push( msg)
    this.length++
    this.out.resolve()
  }
}

ProtoMessageQueue.tryPut = function message_queue_try_put( msg ){
  if( this.closed
  ||  this.full
  )return false
  this.queue.push( msg)
  this.length++
  this.out.resolve()
  return true
}

ProtoMessageQueue.get = function message_queue_get(){
  var that = this
  var step = CurrentStep
  var task = step.task
  if( this.empty ){
    task.pause()
    this.in.then( function(){
      if( task.step !== step )return
      task.stepResult = this.queue.shift()
      task.resume()
    })
  }else{
    task.stepResult = this.queue.shift()
    --this.length
    if( !that.empty ){
      that.in.resolve()
    }
  }
}

ProtoMessageQueue.tryGet = function message_queue_try_get(){
  if( this.closed
  ||  this.empty
  )return [false]
  var msg = this.queue.shift()
  --this.length
  if( !this.empty ){
    this.in.resolve()
  }
  return [true, msg]
}

ProtoMessageQueue.__defineGetter__( "in", function(){
  var promise = this.getPromise
  if( promise )return promise
  this.getPromise = promise = MakePromise()
  if( !this.empty ){
    promise.resolve()
  }
  return promise
})

ProtoMessageQueue.__defineGetter__( "out", function(){
  var promise = this.putPromise
  if( promise )return promise
  this.putPromise = promise = MakePromise()
  if( !this.full ){
    promise.resolve()
  }
  return promise
})

ProtoMessageQueue.__defineGetter__( "empty", function(){
  return !!this.length
})

ProtoMessageQueue.__defineGetter__( "full", function(){
  return this.length >= this.capacity
})

/* ----------------------------------------------------------------------------
 *  Generator. next()/yield() protocol
 */

function Generator(){
  var that = this
  this.task       = null // generator task, the one that yields
  this.getPromise = null // ready when ready to .next()
  this.getMessage  = null
  this.putPromise = null //  ready when ready to .yield()
  this.putMessage = null
  this.closed     = false
  return this
}

var ProtoGenerator = Generator.prototype

ProtoTask.generator = function task_generator(){
  return new Generator()
}

ProtoTask.Generator = function( block ){
// Return a "Generator Constructor", much like L8.Task() does but the returned
// value is a Generator Task, not just a regular Task. I.e. it can "yield".
  return function(){
    var args = arguments
    var parent = L8.current
    var gen = L8.generator()
    var task = MakeTask( parent, false, true) // detached (spawn)
    // ToDo: generator task object should be reuseable using task.free()
    L8_EnqueueStep( MakeStep( task, function(){
      block.apply( task, args)
    }))
    gen.task = task
    var closer = function(){
      if( task.optional.generator ){
        gen.close()
        task.optional.generator = null
      }
      if( parent.optional.generator ){
        gen.close()
        parent.optional.generator = null
      }
    }
    task.then(   closer, closer)
    parent.then( closer, closer)
    parent.optional.generator = task.optional.generator = gen
    return task
  }
}

ProtoTask.yield = function( val ){
  var task = L8.current
  var gen
  var gen_task = task
  while( gen_task ){
    gen = gen_task.optional.generator
    if( gen ){
      gen.yield( val)
      return task
    }
    gen_task = gen_task.parentTask
  }
  task.raise( new Error( "Cannot yield(), not a l8 generator"))
  return task
}

ProtoTask.next = function( val ){
  var task = L8.current
  var gen
  var gen_task = task
  while( gen_task ){
    gen = gen_task.optional.generator
    if( gen ){
      gen.next( val)
      return task
    }
    gen_task = gen_task.parentTask
  }
  task.raise( new Error( "Cannot generate(), not a l8 generator"))
  return task
}

ProtoGenerator.__defineGetter__( "promise", function(){
  return this.get
})

ProtoGenerator.then = function port_then( callback, errback ){
  return this.get.then( callback, errback)
}

ProtoGenerator.next = function( msg ){
  var that = this
  var task = L8.current
  var step = task.currentStep
  // Pause until producer yields
  task.pause()
  this.get.then( function( get_msg ){
    that.getPromise = null
    that.put.resolve( that.putMessage = msg )
    if( task.pausedStep === step ){
      if( that.closed ){
        // return task.break
        task.stepError = L8.breakEvent
      }else{
        task.stepResult = get_msg
      }
      task.resume()
    }
  })
  return this
}

ProtoGenerator.tryNext = function( msg ){
// Like .generate() but never blocks
  if( this.closed )return [false]
  if( !this.getPromise.wasResolved )return [false]
  this.getPromise = null
  this.put.resolve( this.putMessage = msg)
  return [true, this.getMessage]
}

ProtoGenerator.yield = function( msg ){
  var that = this
  this.task = task
  this.get.resolve( this.getMessage = msg)
  var task = L8.current
  var step = task.currentStep
  // Pause until consumer calls .next()
  task.pause()
  this.put.then( function( put_msg ){
    that.putPromise = null
    if( task.pausedStep === step ){
      if( that.closed ){
        // return task.break
        task.stepError = L8.breakEvent
      }else{
        task.stepResult = put_msg
      }
      task.resume()
    }
  })
  return this
}

ProtoGenerator.tryYield = function( msg ){
// Like .yield() but never blocks
  if( this.closed )return [false]
  if( !this.putPromise.wasResolved )return [false]
  this.putPromise = null
  this.get.resolve( this.getMessage = msg)
  return [true, this.putMessage]
}

ProtoGenerator.close = function generator_close(){
  if( this.closed )return this
  this.closed = true
  if( this.getPromise ){ this.getPromise.resolve() }
  if( this.putPromise ){ this.putPromise.resolve() }
  return this
}

ProtoGenerator.__defineGetter__( "get", function(){
  var promise = this.getPromise
  if( !promise ){
    promise = this.getPromise = MakePromise()
    if( this.closed ){
      promise.resolve()
    }
  }
  return promise
})

ProtoGenerator.__defineGetter__( "put", function(){
  var promise = this.putPromise
  if( !promise ){
    promise = this.putPromise = MakePromise()
    if( this.closed ){
      promise.resolve()
    }
  }
  return promise
})


/* ----------------------------------------------------------------------------
 *  Signal
 */

function Signal(){
  this.nextPromise = MakePromise()
  this.closed = false
}
var ProtoSignal = Signal.prototype

ProtoTask.signal = function task_signal( on ){
  return new Signal( on)
}

ProtoSignal.__defineGetter__( "promise", function(){
// Returns an unresolved promise that .signal() will resolve and .close() will
// reject.  Returns an already rejected promise if signal was closed.
  var promise = this.nextPromise
  if( this.closed )return promise
  return !promise.wasResolved ? promise : (this.nextPromise = MakePromise())
})

ProtoMessageQueue.then = function signal_then( callback, errback ){
  return this.promise.then( callback, errback)
}

ProtoSignal.signal = function signal_signal( value ){
// Resolve an unresolved promise that .promise will provide. Signals are not
// buffered, only the last one is kept.
  if( this.nextPromise.wasResolved && !this.closed ){
    this.nextPromise = MakePromise()
  }
  this.nextPromise.resolve( value )
}

ProtoSignal.close = function signal_close(){
  if( this.closed )return
  this.closed = true
  if( this.nextPromise.wasResolved ){
    this.nextPromise = MakePromise()
  }
  this.nextPromise.reject( L8.closeEvent)
}

/* ----------------------------------------------------------------------------
 *  Timeout
 */

function Timeout( delay ){
  var promise = this.timedPromise = MakePromise()
  setTimeout( function(){ promise.resolve() }, delay)
}
var ProtoTimeout = Timeout.prototype

ProtoTask.timeout = function( delay ){
  return new Timeout( delay)
}

ProtoTimeout.__defineGetter__( "promise", function(){
  return this.timedPromise
})

ProtoTimeout.then = function( callback, errback ){
  return this.timedPromise.then( callback, errback)
}


/* ----------------------------------------------------------------------------
 *  Selector
 */

function Selector( list, is_or ){
  this.allPromises = list
  this.firePromise = null
  this.result      = null
  this.isOr        = is_or // "Or" selectors ignore false results
}
var ProtoSelector = Selector.prototype

ProtoTask.selector = ProtoTask.any = function( ll ){
  var list = (arguments.length === 1 && (ll instanceof Array)) ? ll : arguments
  return new Selector( list)
}

ProtoTask.or = function( ll ){
  var list = (arguments.length === 1 && (ll instanceof Array)) ? ll : arguments
  return new Selector( list, true)
}

ProtoTask.select = function(){
  var selector = new Selector( arguments)
  return this.wait( selector)
}

ProtoSelector.__defineGetter__( "promise", function(){
  var promise = this.firePromise
  if( promise )return promise
  var that = this
  var list = this.allPromises
  this.firePromise = promise = MakePromise()
  var len = list.length
  if( !len ){
    promise.resolve( null)
    return promise
  }
  var count = 0
  function ok( r ){
    if( !that.result ){
      try{
        while( r instanceof Function ){
          r = r.call( L8)
        }
      }catch( e ){
        return ko( e)
      }
      if( r.then ){
        r.then( ok, ko)
      }else{
        count++
        if( r || !that.isOr || count === len ){
          that.result = that.isOr ? r : [null,r]
          promise.resolve( that.result)
        }
      }
    }
  }
  function ko( e ){
    count++
    if( !that.result ){
      that.result = [e,null]
      promise.resolve( that.result)
    }
  }
  var item
  var buf = []
  for( var ii = 0 ; ii < len ; ii++ ){
    item = list[ii]
    while( item instanceof Function ){
      item = item.call( L8)
    }
    if( item.then ){
      buf.push( item)
    }else{
      ok( item)
      return promise
    }
  }
  if( len = buf.length ){
    for( ii = 0 ; ii < len ; ii++ ){
      item = buf[ii]
      item.then( ok, ko)
    }
  }
  return promise
})

ProtoSelector.then = function( callback, errback ){
  return this.firePromise.then( callback, errback)
}

/* ----------------------------------------------------------------------------
 *  Aggregator
 */

function Aggregator( list, is_and ){
  this.allPromises = list
  this.results     = []
  this.result      = list.length
  this.firePromise = null
}
var ProtoAggregator = Aggregator.prototype

ProtoTask.aggregator = ProtoTask.all = function( ll ){
  var list = (arguments.length === 1 && (ll instanceof Array)) ? ll : arguments
  return new Aggregator( list)
}

ProtoTask.and = function( ll ){
  var list = (arguments.length === 1 && (ll instanceof Array)) ? ll : arguments
  return new Aggregator( list, true)
}

ProtoAggregator.__defineGetter__( "promise", function(){
  var promise = this.firePromise
  if( promise )return promise
  var that = this
  var list = this.allPromises
  this.firePromise = promise = MakePromise( list.length === 0)
  var results = this.results
  var len = list.length
  if( !len ){
    promise.resolve( results)
    return promise
  }
  // ToDo: should respect order, need an index
  function ok( r ){
    try{
      while( r instanceof Function ){
        r = r.call( L8)
      }
    }catch( e ){
      return ko( e)
    }
    if( r.then ){
      r.then( ok, ko)
    }else{
      results.push( [null,r])
      if( that.result ){ that.result = r }
      if( results.length === list.length ){
        promise.resolve( that.isAnd ? that.result : results)
      }
    }
  }
  function ko( e ){
    results.push( [e,null])
    if( results.length === list.length ){
      promise.resolve( that.isAnd ? false : results)
    }
  }
  var item
  for( var ii = 0 ; ii < len ; ii++ ){
    item = list[ii]
    while( item instanceof Function ){
      item = item.call( L8)
    }
    if( item.then ){
      item.then( ok, ko)
    }else{
      ok( item)
    }
  }
  return promise
})

ProtoAggregator.then = function( callback, errback ){
  return this.promise.then( callback, errback)
}

/* ----------------------------------------------------------------------------
 *  Tests
 */

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
      .failure( function( e ){ t( "unexpected failure", e) })
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
    .step(  function(){ setTimeout( this.walk, 0) })
    .step(  function(){ t( "sleep/timeout done")  })
    .failure( function( e ){ t( "unexpected failure", e) })
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
    .failure( function( e ){ t( "unexpected failure", e) })
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
    test = 5; t( "start"); this
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
    .failure( function( e ){ t( "unexpected failure", e)  })
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
    .failure( function( e ){ t( "unexpected failure", e) })
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
    .failure( function( e ){ t( "unexpected failure", e) })
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
      test_8()
    })
  })

  var test_8 = L8.compile( function r(){
    test = 8
    var f1 = L8.Task( function( p1, p2 ){
      t( "p1", p1, "p2", p2)
      return [p1,p2]
    })
    step;
      t( "pass parameter, get result");
      f1( "aa", "bb")
    step( r );
      t( "both", r.join( "+"))
      f1( "11", "22")
    step( a, b ); t( "a", a, "b", b)
    fork; return "f1"
    fork; return "f2"
    step( f1, f2 ); t( "f1", f1, "f2", f2)
    fork; f1( "hello", "world")
    fork; f1( "keep calm", "carry on")
    step( h, k ); t( h.join( "! "), k.join( "? "))
    failure( e ); t( "unexpected error", e)
    final; check(
      "p1, aa, p2, bb",
      "both, aa+bb",
      "a, 11, b, 22",
      "f1, f1, f2, f2",
      "hello! world, keep calm? carry on"
    )
    test_9()
  })

  var test_9 = L8.Task( function(){
    test = 9
    var fibonacci = function(){
      var i = 0, j = 1;
      repeat; begin
        t( "yield", i)
        this.yield( i);
        var tmp = i;
        i  = j;
        j += tmp;
      end
      step; t( "producer done")
      failure( e ); t( "fib, unexpected error", e)
    }
    fibonacci = L8.compileGenerator( fibonacci)
    var gen = fibonacci()
    var count_down = 10
    this.repeat( function(){
      this.step( function(   ){
        if( !count_down-- ) this.break
        gen.next()
      }).step( function( r ){
        t( count_down, "fibo", r)
      })
    }).step( function(){
      t( "consumer done")
    }).failure( function( e ){ t( "unexpected error", e)
    }).final( function(){
      check(
        "fibo, 1",
        "fibo, 1",
        "fibo, 2",
        "fibo, 3",
        "fibo, 5",
        "fibo, 8",
        "fibo, 13",
        "fibo, 21",
        "fibo, 34",
        "yield, 55",
        "consumer done"
      )
      test_10()
    })
  })

  var test_10 = L8.Task( function(){
    test = 10
    var inner = L8.Task( function(){
      innerer( this)
      this.step(    function(      ){ t( "!!! Unexpected step in inner()")})
      this.success( function( r    ){ t( "inner success", r) })
      this.final(   function( e, r ){ t( "inner final", e, r) })
    })
    var innerer = L8.Task( function( ret ){
      innerest( ret)
      this.step(    function(      ){ t( "!!! Unexpected step in innerer()")})
      this.success( function( r    ){ t( "innerer success", r) })
      this.final(   function( e, r ){ t( "innerer final", e, r) })
    })
    var innerest = L8.Task( function( ret ){
      this.final(   function( e, r ){ t( "innerest final", e, r) })
      ret.return( "From innerest")
      this.step(    function(      ){ t( "!!! Unexpected step in innerer()")})
      this.success( function( r    ){ t( "!!! Unexpected success", r) })
    })
    this
    .step(    function(   ){ t( "inner()")             })
    .step(    function(   ){ inner()                   })
    .step(    function( r ){ t( "return", r)           })
    .failure( function( e ){ t( "Unexpected error", e) })
    .final(   function(   ){
      check(
        "inner()",
        "innerest final, From innerest",
        "innerer success, From innerest",
        "innerer final, From innerest",
        "inner success, From innerest",
        "inner final, From innerest",
        "return, From innerest"
      )
      test_11()
    })
  })

  var test_11 = L8.Task( function(){
    test = 11
    function recur( n, next ){
      if( --n > 0 ){
        L8_NextTick( function(){ recur( n, next) })
      }else{
        next()
      }
    }
    var l8recur = L8.Task( function l8recur_task( n ){
      if( --n > 0 ){ l8recur( n) }
    })
    var now
    var n = 3
    var p = 100000
    var factor = 50 // 50 by december 2012
    var ii
    var duration
    var l8duration
    var tid
    var was_debug = L8.debug()
    this
    .step( function(){ this.sleep( 1) })
    .step( function(){ now = L8.timeNow; L8.debug( false) })
    .step( function(){
      var done = 0
      var task = this
      for( var ii = 0 ; ii < p ; ii++ ){
        L8_NextTick( function(){
          recur( n, function(){ if( ++done === p ) task.resume() })
        })
      }
      task.pause()
    })
    .step( function(){ this.sleep( 1) })
    .step( function(){
      duration = -1 + L8.timeNow - now
      t( n * p, "times async recur()", duration, "millisecs")
    })
    .step( function(){ this.sleep( 1) })
    .step( function(){
      now = L8.timeNow
      ii  = 0
      tid = NextTaskId
    })
    .repeat( function(){
      if( ii >= p / factor ) this.break
      l8recur( n)
      ii++
    })
    .step( function(){ this.sleep( 1) })
    .step( function(){
      L8.debug( was_debug)
      l8duration = (-1 + (L8.timeNow - now)) * factor
      t( n * p, "times l8recur()", l8duration, "estimated millisecs")
      t( l8duration / duration, "times slower than if native")
      t( (n * p) / duration   * 1000, "native call/sec")
      t( (n * p) / l8duration * 1000, "l8 call/sec")
      t( (NextTaskId - tid) / l8duration * 1000 * factor, "l8 task/sec")
    })
    .failure( function( e ){ t( "!!! Unexpected error, e") })
    .final( function(){
      check(
        "l8 call/sec"
      )
      test_last()
    })
  })

  var test_last = function(){
    trace( "SUCCESS!!! All tests ok")
  }

if( DEBUG ){
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
  test_1()
}else{
  L8.tests = test_1
}

return L8

})
})(typeof define == 'function' && define.amd
  ? define
  : function (factory) { typeof exports === 'object'
		? (module.exports = factory())
		: (this.l8        = factory());
	}
	// Boilerplate for AMD, Node, and browser global
  // Copied from when.js, see https://github.com/cujojs/when/blob/master/when.js
);
