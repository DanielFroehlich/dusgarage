const debug = require('debug')('dusgarage')
var express = require('express');
var cron = require('node-cron');
var app = express();
var fs = require("fs");

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
}


app.get('/parkinglots', function (req, res) {
    debug("get parkinglots")
    res.end( JSON.stringify(parkinglots));
})
app.get('/parkinglots/:id', function (req, res) {
  debug("get parkinglots id=%s", req.params.id)
  res.end( JSON.stringify(parkinglots[req.params.id]));
})

app.post('/parkinglots/:id', function (req, res) {
  debug("post parkinglots id=%s", req.params.id)

  parkinglot = parkinglots[req.params.id]
  parkinglot.state = getNextState(parkinglot.state)

  // Write back state file:
  fs.writeFile( __dirname + "/" + "parkinglots.json", JSON.stringify(parkinglots, null, 2), function(err) {
     if (err) {
        return console.error(err);
     }
   })

  res.end( JSON.stringify(parkinglots[req.params.id]))
})


var server = app.listen(8081, function () {
  var host = server.address().address
  var port = server.address().port

  console.log("Reading parkinglots")
  fs.readFile( __dirname + "/" + "parkinglots.json", 'utf8', function (err, data) {
      parkinglots = JSON.parse(data)
    });

  console.log("Reading states")
  fs.readFile( __dirname + "/" + "states.json", 'utf8', function (err, data) {
      arrayOfStates = JSON.parse(data)
  });

  console.log("Serving static content")
  app.use('/', express.static(__dirname + '/public'));

  console.log("Example app listening at http://%s:%s", host, port)

})

 // ss mm hh day month dayOfWeek
cron.schedule('* 42 04 * * *', function(){
  resetStates()
});
