const debug = require('debug')('dusgarage')
var express  = require('express');
var cookieParser = require('cookie-parser')
var app   = express();
var request = require('request')
var http = require('http');
var server = http.createServer(app);
var io    = require('socket.io').listen(server);
var cron  = require('node-cron');
var fs    = require("fs");
var GoogleStrategy  = require( "passport-google-oauth" ).OAuth2Strategy;
var passport = require( "passport" );
var env = process.env.NODE_ENV || "dev";
var cfg = require("../config."+env);

var parkinglots;
var arrayOfStates;
var doorState = "UNKNOWN";
var isSecurityEnabled = false;

// ------------- Init stuff ----------------
app.use(cookieParser());
//app.use(express.bodyParser());
app.use(passport.initialize());



// ----------- BUSINESS LOGIC ----------
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
  io.sockets.emit('updateLots', parkinglots);
}

function checkDoorAvailability() {
  debug("checkDoorAvailability with URL %s", cfg.DOOR_URL_CHECK )

  var req = request.get(cfg.DOOR_URL_CHECK , {timeout: cfg.DOOR_TIMEOUT}, function(err, res, body) {
    debug('response');
    if (!err && res.statusCode == 200) {
      handleNewDoorState("ONLINE");
    } else{
      debug("err=%s", err)
      handleNewDoorState("OFFLINE");
    }
  });
}

function handleNewDoorState(newDoorState) {
  if (newDoorState !== doorState) {
    doorState = newDoorState;
    debug("Broadcast new door state %s to %s connected clients...", doorState, io.engine.clientsCount)
    io.sockets.emit('updateDoor', doorState);
  }

}


// ----------- REST SERVICES ----------

app.get('/parkinglots', function (req, res) {
    debug("get parkinglots")
    res.end( JSON.stringify(parkinglots));
})
app.get('/parkinglots/:id', function (req, res) {
  debug("get parkinglots id=%s", req.params.id)
  res.end( JSON.stringify(parkinglots[req.params.id]));
})

app.post('/parkinglots/:id', ensureAuthenticated, function (req, res) {
  debug("post parkinglots id=%s", req.params.id);
  parkinglot = parkinglots[req.params.id];
  oldState = parkinglot.state;
  newState = getNextState(oldState);
  modified = false;

  if (newState.name == "FREE") {
    // Only the current owner can free his parking lot:
    if (isSecurityEnabled==false || parkinglot.user == req.user.email) {
      parkinglot.user = "-nobody-";
      parkinglot.state = newState;
      modified = true;
    }
  } else if (newState.name == "RESERVED") {
    if (isSecurityEnabled) {
      parkinglot.user = req.user.email;
    } else {
      parkinglot.user = "-unknown-";
    }
    parkinglot.state = newState;
    modified = true;
  } else if (newState.name == "OCCUPIED") {
      // Only user with reservation can occupy:
      if (isSecurityEnabled==false || parkinglot.user == req.user.email) {
         parkinglot.state = newState;
         modified = true;
    }
  }

  if (modified)
    parkinglotModified();

  res.end( JSON.stringify(parkinglot));
});

app.post('/openDoor', ensureAuthenticated, function (req, resClient) {
  debug("post openDoor");
  var req = request.post(cfg.DOOR_URL_OPEN, {timeout: cfg.DOOR_TIMEOUT}, function(err, res, body) {
    debug('response');
    if (!err && res.statusCode == 200) {
      resClient.status(200).json({ message: "OK" });
      handleNewDoorState("ONLINE");
    } else{
      resClient.status("503").json({ message: err });
      handleNewDoorState("OFFLINE");
    }
    resClient.end();
  });

});

app.get('/', ensureAuthenticated, function (req, res) {
	res.sendFile(__dirname + '/client.html');
});


app.get('/health', function(req, res){
  res.send('1');
});


// ------------- Websocket stuff: ----------------

io.sockets.on('connection', function (socket) {
  debug("websocket client connected");
  // Send update to this client in case client was disconnected for a long time
  // and state has changed meanwhile:
  socket.emit('updateLots', parkinglots);
  socket.emit('updateDoor', doorState);

  socket.on('disconnect', function () {
    debug("websocket client disconnect");
  });
});


// ------------- Authentication stuff: ----------------
console.log("Setting up google authentication..");
passport.use(new GoogleStrategy({
        clientID: cfg.GOOGLE_CLIENT_ID,
        clientSecret: cfg.GOOGLE_CLIENT_SECRET,
        callbackURL: cfg.GOOGLE_CALLBACK_URL
    },
    function(accessToken, refreshToken, profile, done) {
        debug("passport-use");
        process.nextTick(function () {
            return done(null, profile);
        });
    }
));
passport.serializeUser(function(user, done) {
    debug("passport-serializeUser:");
    debug("   user.id=%s", user.id);
    debug("   user.displayName=%s", user.displayName);
    debug("   user.email=%s", user.emails[0].value);
    debug("   user.photo=%s", user.photos[0].value);
    done(null, user.emails[0].value);
});
passport.deserializeUser(function(id, done) {
  debug("passport-deserializeUser id = %s", id);
  var user = new Object();
  user.email = id;
  done(null, user);
});

app.get('/auth/google', passport.authenticate('google',
    { scope: ['https://www.googleapis.com/auth/userinfo.email'] }),
    function(req, res){} // this never gets called
);
app.get('/oauth2callback',
  passport.authenticate('google', { session: false, successRedirect: '/', failureRedirect: '/auth/google' }),
  function(req,resp) {
    resp.cookie()
  }
);

function ensureAuthenticated(req, res, next) {
  if (isSecurityEnabled) {
    debug("ensureAuthenticated");
      if (req.isAuthenticated()) { return next(); }
      debug("ensureAuthenticated: req is not authenticated");
      res.redirect("/auth/google");

  } else {
    return next();
  }
}


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
server.listen(cfg.SERVER_PORT);


console.log("Scheduling cronjobs....")
 // ss mm hh day month dayOfWeek
cron.schedule(cfg.CRON_RESET_LOTS, function(){
  resetStates()
});

cron.schedule(cfg.CRON_DOOR_CHECK, function(){
  checkDoorAvailability()
});


console.log("Server startup completed! Listening at http://%s:%s", server.address().address, server.address().port)
