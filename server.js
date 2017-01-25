const debug = require('debug')('dusgarage')
var express  = require('express');
var app   = express();
var server = require('http').createServer(app);
var io    = require('socket.io').listen(server);
var cron  = require('node-cron');
var fs    = require("fs");

var parkinglots;
var arrayOfStates;

function getNextState(state) {
  debug("getNextState state=%j", state);

  for (i=0; i<arrayOfStates.length; i++ ) {
    if (state.name == arrayOfStates[i].name) {
      return arrayOfStates[(i+1) % arrayOfStates.length];
    }
  }

  // State not found: return first:
  return arrayOfStates[0];
}


function resetStates() {
  console.log('resetting all states to initial state %s', arrayOfStates[0].name);
  for (i=0; i<parkinglots.length; i++ ) {
    parkinglots[i].state = arrayOfStates[0];
  }
  parkinglotModified();
}

function parkinglotModified() {
  debug("Persisting state...")
  fs.writeFile( __dirname + "/" + "parkinglots.json", JSON.stringify(parkinglots, null, 2), function(err) {
     if (err) {
        return console.error(err);
     }
   })

  debug("Broadcast state change to %s connected clients...", io.engine.clientsCount)
  io.sockets.emit('update', parkinglots);
}

app.get('/parkinglots', function (req, res) {
    debug("get parkinglots")
    res.end( JSON.stringify(parkinglots));
})
app.get('/parkinglots/:id', function (req, res) {
  debug("get parkinglots id=%s", req.params.id)
  res.end( JSON.stringify(parkinglots[req.params.id]));
})

app.get('/', function (req, res) {
	res.sendFile(__dirname + '/public/client.html');
});

app.post('/parkinglots/:id', function (req, res) {
  debug("post parkinglots id=%s", req.params.id);
  parkinglot = parkinglots[req.params.id];
  parkinglot.state = getNextState(parkinglot.state);

  parkinglotModified();

  res.end( JSON.stringify(parkinglot));
})


io.sockets.on('connection', function (socket) {
  debug("websocket client connected");
  // Send update to this client in case client was disconnected for a long time
  // and state has changed meanwhile:
  socket.emit('update', parkinglots);

  socket.on('disconnect', function () {
    debug("websocket client disconnect");
  });
});


// ------------- INIT ----------------

console.log("Reading state...")
fs.readFile( __dirname + "/" + "parkinglots.json", 'utf8', function (err, data) {
    parkinglots = JSON.parse(data)
  });

console.log("Reading states...")
fs.readFile( __dirname + "/" + "states.json", 'utf8', function (err, data) {
    arrayOfStates = JSON.parse(data)
});

console.log("Creating server socket...")
server.listen(8081);


console.log("Scheduling cronjob....")
 // ss mm hh day month dayOfWeek
cron.schedule('* 42 04 * * *', function(){
  resetStates()
});

console.log("Server startup completed! Listening at http://%s:%s", server.address().address, server.address().port)
