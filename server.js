const debug = require('debug')('dusgarage')
var express  = require('express');
var cookieParser = require('cookie-parser')
var session = require('express-session')
var FileStore = require('session-file-store')(session);
var app   = express();
var server = require('http').createServer(app);
var io    = require('socket.io').listen(server);
var cron  = require('node-cron');
var fs    = require("fs");
var GoogleStrategy  = require( "passport-google-oauth" ).OAuth2Strategy;
var passport = require( "passport" );
var env = process.env.NODE_ENV || "dev";
var cfg = require("./config."+env);

var parkinglots;
var arrayOfStates;
var doorState = "OFFLINE";

// ------------- Init stuff ----------------
app.use(cookieParser());
//app.use(express.bodyParser());
app.use(session({
//  store: new FileStore({ttl: 315360000000}),
  secret: 'keyboard cat',
  cookie: {maxAge: 315360000000}
}));
app.use(passport.initialize());
app.use(passport.session());



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
    if (parkinglot.user == req.user.email) {
      parkinglot.user = "-nobody-";
      parkinglot.state = newState;
      modified = true;
    }
  } else if (newState.name == "RESERVED") {
    parkinglot.user = req.user.email;
    parkinglot.state = newState;
    modified = true;
  } else if (newState.name == "OCCUPIED") {
      // Only user with reservation can occupy:
      if (parkinglot.user == req.user.email) {
         parkinglot.user = req.user.email;
         parkinglot.state = newState;
         modified = true;
    }
  }

  if (modified)
    parkinglotModified();

  res.end( JSON.stringify(parkinglot));
});

app.post('/openDoor', ensureAuthenticated, function (req, res) {
  debug("post openDoor");

//  io.sockets.emit('updateDoor', "ONLINE");

  res.status(503).json({ message: "Backend is offline" });
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
    { scope: ['https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email'] }),
    function(req, res){} // this never gets called
);
app.get('/oauth2callback', passport.authenticate('google',
    { successRedirect: '/', failureRedirect: '/auth/google' }
));

function ensureAuthenticated(req, res, next) {
  debug("ensureAuthenticated");
    if (req.isAuthenticated()) { return next(); }
    debug("ensureAuthenticated: req is not authenticated");
    res.redirect("/auth/google");
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


console.log("Scheduling cronjob....")
 // ss mm hh day month dayOfWeek
cron.schedule('42 42 04 * * *', function(){
  resetStates()
});



console.log("Server startup completed! Listening at http://%s:%s", server.address().address, server.address().port)
