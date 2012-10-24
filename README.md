l8
==

Light task manager for javascript/coffeescript/livescript...

"Let's walk these steps"

Schedule the execution of multiple "tasks". A task is made of "steps", much
like a function is made of statements. Tasks can nest, much like blocks of
statements. The main flow control structures are the sequential execution of
steps, steps that loop until they exit, steps that wait for something and
error propagation similar to exception handling.

Execution goes from "step" to "step" by way of "walk". If one cannot walk a
step, one can wait for something and maybe retry later.

l8 tasks are a kind of user level non preemptive threads. They are neither
native threads, nor worker threads, nor fibers nor the result of some CPS
transformation. Just a bunch of cooperating closures.

API
---

```
  l8.begin              -- enter new L8 scope
    .step( block )      -- queue a new step
    .walk( block )      -- walk a step, at most once per step
    .loop               -- enter a non blocking loop, made of iterative steps
    .next               -- enter next iteration step in a non blocking loop
    .repeat( block )    -- enter a blocking loop
    ._continue          -- like "continue", for blocking loops
    ._break             -- "break" for blocking loops
    ._return            -- like "return" in normal flow
    .raise( error )     -- raise an error in task
    .spawn( blk [, q] ) -- start a new sub task, maybe suspended
    .then( ... )        -- Promise/A protocol
    .error( block )     -- block to run when task is done but with error
    .progress( block )  -- block to run when some task is done or step walked
    .final( block )     -- block to run when task is all done
    .l8                 -- return global L8 object
    .task               -- return current task
    .parent             -- return parent task
    .tasks              -- return sub tasks
    .top                -- return top task of sub task
    .state              -- return state of task, I->[Q|R]*->C/E/D
    .suspend            -- queue step, waiting until task is resumed
    .waiting            -- true if task waiting while running (ie is queued)
    .resume             -- resume execution of a task waiting at some step
    .running            -- true if task not done nor waiting
    .cancel             -- cancel task & its sub tasks, brutal
    .canceled           -- true if task was canceled
    .stop               -- gentle cancel
    .stopping           -- true after a gentle cancel, until task is done
    .stopped            -- true if task was gently canceled (gracefull)
    .done               -- true if task done, else it either wait or runs
    .succeed            -- true if task done without error
    .failed             -- true if task done but with an error
    .err                -- return last raised error
    .timeout( milli )   -- cancel task if not done in time
    .delay( milli )     -- block for a while, then reschedule step
    .wait( lock )       -- queue step until some lock opens, then retry
    .end                -- leave scope or loop
    .scope( function )  -- return the L8 scope guarded version of a function

  These methods, if invoked against the global L8 object, will get forwarded
  to the current task.
```

TBD: semaphores, mutexes, locks, message queues, signals, etc...

Examples
--------

Two steps.

````
  function fetch_this_and_that( a, b, callback ){
    var result_a = null
    var result_b = {content:null}
    // Hypothetical synchrone version
    // result_a = fetch( a)
    // if( !result_a.err ){
    //   result_b = fetch( b)
    // }
    // callback( result_a.err || result_b.err, result_b.content)
  l8.begin
    .step( function(){
      fetch(
        a,
        this.walk( function( err, content ){
          result_a = { err: err, content: content }
        })
      )
    })
    .step( function(){
      if( result_a.err ) this.raise( result_a.err)
      fetch(
        b,
        this.walk( function( err, content ){
          result_b = { err: err, content: content }
        })
      )
    })
    .final( function(){ callback( this.err, result_b.content) })
  .end}
```

Coffeescript, shorter, also thanks to scope() functor

```
  fetch_this_and_that = l8.scope (a,b,cb) ->
    r_a = r_b = {content:null}
    @step  -> fetch a, @walk (err,content) -> r_a = {err,content}
    @step  ->
      @raise r_a.err if r_a.err
      fetch b, @walk (err,content) -> r_b = {err,content}
    @final -> cb @err, r_b.content
```

Multiple steps, dynamically created, run in parallel

```
  function fetch_all( urls, callback ){
    var results = []
    l8.begin
      .step( function(){
        this.loop; for( var url in urls ){
          this.next
          fetch( url, this.walk( function( err, content ){
            result.push({ url: url, err: err, content: content })
          }))
        }
        this.end
      })
      .final( function(){ callback( results ) })
    .end
  }

  fetch_all = l8.scope (urls, callback) ->
    result = []
    @step ->
      @loop; for url in urls
        @next
        fetch url, @walk (err, content) ->
          result.push {url, err, content}
      @end
    @final -> callback results
```

Multiple steps, dynamically created, run sequentially

```
  function fetch_all_seq( urls, callback ){
    var results = []
    l8.begin
      .step( function(){
        this.loop; for( var url in urls ){
          this.step( function(){
            fetch( url, this.walk( function( err, content ){
              result.push({ url: url, err: err, content: content })
            }))
          })
        }
        this.end
      })
      .final( function(){ callback( results ) })
    .end
  }

  fetch_all_seq = l8.scope (urls, callback) ->
    results = []
    @step ->
      @loop; for url in urls
        @step -> fetch url, @walk -> result.push {url, err, content}
      @end
    @final -> callback results
```

Repeated step, externally terminated, gently

```
  spider = l8.scope (urls) ->
    queue = urls
    @repeat ->
      @step -> url = queue.shift
      @step -> @delay 10000 if @parent.tasks.length > 10
      @step ->
        @_break if @stopping
        fetch url, @walk (err,urls) ->
          return if err or @stopping
          for url in urls
            queue.unshift url unless url in queue

  spider_task = l8.spawn -> spider( "http://xxx.com")
  ...
  stop_spider = -> spider_task.stop
```

Design
------

The key idea is to break a javascript function into "steps" and then walk thru
these steps much like the javascript interpreter runs thru the statements
of a function. This is quite verbose however. But not so much when using
CoffeeScript. This is why, after considering the idea years ago, I waited
until now to implement it. That my cousin Jean Vincent would consider breaking
a function into steps as something close enough to threading was another strong
motivator.

To break functions into steps, I use a DSL (domain specific language) API.
Once the AST (abstact syntax tree) is built, I interpret it.

This becomes really interesting when the AST gets dynamically modified!

Nodes in the AST are called "steps". They are the smallest non interruptible
executable entities.

Each Step belongs to a Task. Task can involve sub tasks that cooperate.
